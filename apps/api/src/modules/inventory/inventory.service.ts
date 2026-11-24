import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';

export interface Allocation {
  variantId: number;
  warehouseId: number;
  inventoryId: number;
  quantity: number;
}

interface LockedRow {
  id: number;
  variant_id: number;
  warehouse_id: number;
  quantity_on_hand: number;
  quantity_reserved: number;
  is_default: number;
}

/**
 * All stock changes go through here, always inside the caller's transaction, and always
 * append a stock_movements row. Rows are locked with SELECT … FOR UPDATE so concurrent
 * checkouts serialise per variant and stock can never be oversold.
 */
@Injectable()
export class InventoryService {
  private async lock(tx: Prisma.TransactionClient, variantIds: number[]) {
    const rows = await tx.$queryRaw<LockedRow[]>`
      SELECT i.id, i.variant_id, i.warehouse_id, i.quantity_on_hand, i.quantity_reserved, w.is_default
      FROM inventory i JOIN warehouses w ON w.id = i.warehouse_id
      WHERE w.is_active = 1 AND w.deleted_at IS NULL AND i.variant_id IN (${Prisma.join(variantIds)})
      ORDER BY i.id
      FOR UPDATE`;
    return rows.map((r) => ({
      id: Number(r.id), variantId: Number(r.variant_id), warehouseId: Number(r.warehouse_id),
      onHand: Number(r.quantity_on_hand), reserved: Number(r.quantity_reserved), isDefault: Number(r.is_default) === 1,
    }));
  }

  /**
   * Reserves stock for an order. Prefers the default warehouse, then whichever has most stock,
   * splitting across warehouses only when one can't cover the line.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    lines: Array<{ variantId: number; quantity: number; sku: string }>,
    ref: { orderId: number; userId: number | null },
  ): Promise<Allocation[]> {
    const rows = await this.lock(tx, [...new Set(lines.map((l) => l.variantId))]);
    const allocations: Allocation[] = [];
    const shortages: Array<{ sku: string; requested: number; available: number }> = [];

    for (const line of lines) {
      const candidates = rows
        .filter((r) => r.variantId === line.variantId && r.onHand - r.reserved > 0)
        .sort((a, b) => {
          const aFits = a.onHand - a.reserved >= line.quantity ? 1 : 0;
          const bFits = b.onHand - b.reserved >= line.quantity ? 1 : 0;
          return bFits - aFits || Number(b.isDefault) - Number(a.isDefault) || (b.onHand - b.reserved) - (a.onHand - a.reserved);
        });
      const total = candidates.reduce((s, r) => s + r.onHand - r.reserved, 0);
      if (total < line.quantity) {
        shortages.push({ sku: line.sku, requested: line.quantity, available: total });
        continue;
      }
      let remaining = line.quantity;
      for (const r of candidates) {
        if (!remaining) break;
        const take = Math.min(remaining, r.onHand - r.reserved);
        r.reserved += take; // keep the in-memory view right for later lines of the same variant
        remaining -= take;
        allocations.push({ variantId: line.variantId, warehouseId: r.warehouseId, inventoryId: r.id, quantity: take });
      }
    }
    if (shortages.length) {
      throw new ConflictException({
        message: shortages.length === 1 && shortages[0].available > 0
          ? `Only ${shortages[0].available} of ${shortages[0].sku} left. Please update your bag.`
          : 'Some items in your bag just sold out. Please review your bag.',
        code: 'INSUFFICIENT_STOCK',
        details: shortages,
      });
    }

    for (const a of allocations) {
      const updated = await tx.$executeRaw`
        UPDATE inventory SET quantity_reserved = quantity_reserved + ${a.quantity}
        WHERE id = ${a.inventoryId} AND quantity_on_hand - quantity_reserved >= ${a.quantity}`;
      if (updated !== 1) throw new ConflictException({ message: 'Stock changed while placing your order. Please try again.', code: 'INSUFFICIENT_STOCK' });
      const inv = rows.find((r) => r.id === a.inventoryId)!;
      await tx.stockMovement.create({
        data: {
          inventoryId: a.inventoryId, type: StockMovementType.RESERVATION, quantity: a.quantity, balanceAfter: inv.onHand,
          referenceType: 'order', referenceId: ref.orderId, userId: ref.userId, note: 'Reserved for order',
        },
      });
    }
    return allocations;
  }

  /** Returns reserved stock for an order's unshipped lines (cancellation, payment failure, expiry). */
  async releaseForOrder(tx: Prisma.TransactionClient, orderId: number, userId: number | null, note = 'Order cancelled') {
    const items = await tx.orderItem.findMany({
      where: { orderId, variantId: { not: null }, warehouseId: { not: null } },
      select: { variantId: true, warehouseId: true, quantity: true },
    });
    if (!items.length) return;
    const rows = await this.lock(tx, [...new Set(items.map((i) => i.variantId!))]);
    for (const item of items) {
      const inv = rows.find((r) => r.variantId === item.variantId && r.warehouseId === item.warehouseId);
      if (!inv) continue;
      const release = Math.min(item.quantity, inv.reserved);
      if (!release) continue;
      await tx.$executeRaw`UPDATE inventory SET quantity_reserved = quantity_reserved - ${release} WHERE id = ${inv.id}`;
      inv.reserved -= release;
      await tx.stockMovement.create({
        data: {
          inventoryId: inv.id, type: StockMovementType.RESERVATION_RELEASE, quantity: -release, balanceAfter: inv.onHand,
          referenceType: 'order', referenceId: orderId, userId, note,
        },
      });
    }
  }
}
