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

  /** Locks (creating if needed) the inventory row for a variant in a warehouse. */
  private async lockOne(tx: Prisma.TransactionClient, variantId: number, warehouseId: number) {
    await tx.inventory.upsert({
      where: { variantId_warehouseId: { variantId, warehouseId } },
      create: { variantId, warehouseId },
      update: {},
    });
    const [row] = await tx.$queryRaw<Array<{ id: number; quantity_on_hand: number; quantity_reserved: number; average_cost: Prisma.Decimal }>>`
      SELECT id, quantity_on_hand, quantity_reserved, average_cost FROM inventory
      WHERE variant_id = ${variantId} AND warehouse_id = ${warehouseId} FOR UPDATE`;
    return { id: Number(row.id), onHand: Number(row.quantity_on_hand), reserved: Number(row.quantity_reserved), averageCost: new Prisma.Decimal(row.average_cost) };
  }

  /** Manual stock correction. On-hand may never drop below what is already reserved for customers. */
  async adjust(tx: Prisma.TransactionClient, a: {
    variantId: number; warehouseId: number; delta: number; type: 'ADJUSTMENT' | 'DAMAGE'; note: string; userId: number;
  }) {
    const inv = await this.lockOne(tx, a.variantId, a.warehouseId);
    const next = inv.onHand + a.delta;
    if (next < inv.reserved) {
      throw new ConflictException({ message: `Cannot reduce below ${inv.reserved} units already reserved for customer orders`, code: 'BELOW_RESERVED' });
    }
    await tx.inventory.update({ where: { id: inv.id }, data: { quantityOnHand: next } });
    await tx.stockMovement.create({
      data: { inventoryId: inv.id, type: a.type, quantity: a.delta, balanceAfter: next, referenceType: 'adjustment', note: a.note, userId: a.userId },
    });
    return { inventoryId: inv.id, onHand: next, reserved: inv.reserved };
  }

  /** Goods received from a supplier: adds stock and updates the weighted-average unit cost. */
  async receive(tx: Prisma.TransactionClient, r: {
    variantId: number; warehouseId: number; quantity: number; unitCost: Prisma.Decimal; referenceId: number; userId: number;
  }) {
    const inv = await this.lockOne(tx, r.variantId, r.warehouseId);
    const next = inv.onHand + r.quantity;
    const avg = next > 0
      ? inv.averageCost.mul(Math.max(inv.onHand, 0)).add(r.unitCost.mul(r.quantity)).div(next).toDecimalPlaces(2)
      : r.unitCost;
    await tx.inventory.update({ where: { id: inv.id }, data: { quantityOnHand: next, averageCost: avg } });
    await tx.stockMovement.create({
      data: { inventoryId: inv.id, type: StockMovementType.PURCHASE_RECEIPT, quantity: r.quantity, balanceAfter: next, unitCost: r.unitCost,
        referenceType: 'goods_receipt', referenceId: r.referenceId, userId: r.userId, note: 'Goods received' },
    });
  }

  /** Moves stock out of / into a warehouse for an inter-warehouse transfer. */
  async transferLeg(tx: Prisma.TransactionClient, t: {
    variantId: number; warehouseId: number; quantity: number; direction: 'out' | 'in'; transferId: number; userId: number;
  }) {
    const inv = await this.lockOne(tx, t.variantId, t.warehouseId);
    const delta = t.direction === 'out' ? -t.quantity : t.quantity;
    if (t.direction === 'out' && inv.onHand - inv.reserved < t.quantity) {
      throw new ConflictException({ message: `Only ${inv.onHand - inv.reserved} unreserved units available to transfer`, code: 'INSUFFICIENT_STOCK' });
    }
    await tx.inventory.update({ where: { id: inv.id }, data: { quantityOnHand: inv.onHand + delta } });
    await tx.stockMovement.create({
      data: { inventoryId: inv.id, type: t.direction === 'out' ? StockMovementType.TRANSFER_OUT : StockMovementType.TRANSFER_IN,
        quantity: delta, balanceAfter: inv.onHand + delta, referenceType: 'stock_transfer', referenceId: t.transferId, userId: t.userId },
    });
  }

  /**
   * Dispatch: reserved units leave the building. On-hand and reserved both drop, and a SALE movement is recorded.
   * Lines without a reservation (e.g. legacy data) are deducted from on-hand directly.
   */
  async fulfilOrder(tx: Prisma.TransactionClient, orderId: number, userId: number) {
    const items = await tx.orderItem.findMany({
      where: { orderId, variantId: { not: null }, warehouseId: { not: null } },
      select: { variantId: true, warehouseId: true, quantity: true },
    });
    for (const item of items) {
      const inv = await this.lockOne(tx, item.variantId!, item.warehouseId!);
      const fromReserved = Math.min(item.quantity, inv.reserved);
      const onHand = inv.onHand - item.quantity;
      if (onHand < 0) throw new ConflictException({ message: 'Not enough stock on hand to dispatch this order', code: 'INSUFFICIENT_STOCK' });
      await tx.inventory.update({ where: { id: inv.id }, data: { quantityOnHand: onHand, quantityReserved: inv.reserved - fromReserved } });
      await tx.stockMovement.create({
        data: { inventoryId: inv.id, type: StockMovementType.SALE, quantity: -item.quantity, balanceAfter: onHand,
          unitCost: inv.averageCost, referenceType: 'order', referenceId: orderId, userId, note: 'Dispatched to customer' },
      });
    }
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

import { Global, Module } from '@nestjs/common';

@Global()
@Module({ providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
