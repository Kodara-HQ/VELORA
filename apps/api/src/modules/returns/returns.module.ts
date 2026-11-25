import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseIntPipe, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  OrderStatus, PaymentStatus, PaymentTxnStatus, Prisma, RefundStatus, ReturnReason, ReturnStatus, ReturnType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { PERMISSIONS, type AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';
import { requestContext } from '../../common/utils/request';
import type { RequestContext } from '../../common/types';
import { AuditService } from '../audit/audit.module';
import { InventoryService } from '../inventory/inventory.service';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';
import { PaymentsService } from '../payments/payments.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const DAY = 86_400_000;
const OPEN_RETURN: ReturnStatus[] = [ReturnStatus.REQUESTED, ReturnStatus.APPROVED];
const ref = (p: string) => {
  const d = new Date();
  return `${p}${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${randomBytes(3).toString('hex').toUpperCase()}`;
};

// ─── DTOs ───

class ReturnLineDto {
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @IsString() @MaxLength(80) sku: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100) quantity: number;
  @ApiPropertyOptional({ description: 'Exchanges: the size/colour wanted instead (same product)' })
  @IsOptional() @IsInt() exchangeVariantId?: number;
}

class RequestReturnDto {
  @ApiProperty({ enum: ReturnType }) @IsEnum(ReturnType) type: ReturnType;
  @ApiProperty({ enum: ReturnReason }) @IsEnum(ReturnReason, { message: 'Choose a reason' }) reason: ReturnReason;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) note?: string;
  @ApiProperty({ type: [ReturnLineDto] }) @IsArray() @ArrayMinSize(1, { message: 'Choose at least one item' }) @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => ReturnLineDto) items: ReturnLineDto[];
}

class ReturnQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ReturnStatus }) @IsOptional() @IsEnum(ReturnStatus) status?: ReturnStatus;
  @ApiPropertyOptional({ enum: ReturnType }) @IsOptional() @IsEnum(ReturnType) type?: ReturnType;
}

class NoteDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) note?: string;
}

class ReasonDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3, { message: 'Give a reason' }) @MaxLength(1000) reason: string;
}

class ReceiveLineDto {
  @ApiProperty() @IsInt() returnItemId: number;
  @ApiProperty({ enum: ['RESELLABLE', 'DAMAGED'] }) @IsIn(['RESELLABLE', 'DAMAGED']) condition: 'RESELLABLE' | 'DAMAGED';
}

class ReceiveDto {
  @ApiProperty({ type: [ReceiveLineDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) items: ReceiveLineDto[];
  @ApiPropertyOptional({ enum: ['REFUND', 'EXCHANGE'], description: 'Exchanges can be settled as a refund instead (e.g. size sold out)' })
  @IsOptional() @IsIn(['REFUND', 'EXCHANGE']) resolution?: 'REFUND' | 'EXCHANGE';
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) note?: string;
}

class RefundQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: RefundStatus }) @IsOptional() @IsEnum(RefundStatus) status?: RefundStatus;
}

class ProcessRefundDto {
  @ApiProperty({ enum: ['GATEWAY', 'MANUAL'], description: 'GATEWAY = back to the original card/MoMo via the provider; MANUAL = Finance paid out and records it' })
  @IsIn(['GATEWAY', 'MANUAL']) mode: 'GATEWAY' | 'MANUAL';
  @ApiPropertyOptional({ enum: ['MOMO', 'BANK_TRANSFER', 'CASH', 'STORE_CREDIT'] }) @IsOptional() @IsIn(['MOMO', 'BANK_TRANSFER', 'CASH', 'STORE_CREDIT']) method?: string;
  @ApiPropertyOptional({ description: 'Required for manual payouts: MoMo transaction ID, bank reference…' })
  @IsOptional() @Transform(trim) @Matches(/^[A-Za-z0-9._:/-]{4,100}$/, { message: 'Enter the payout reference (letters, numbers, dashes)' }) reference?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}

class PaymentQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: PaymentTxnStatus }) @IsOptional() @IsEnum(PaymentTxnStatus) status?: PaymentTxnStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) provider?: string;
}

class SweepDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() dryRun?: boolean;
}

const returnInclude = {
  order: { select: { id: true, orderNumber: true, userId: true, guestEmail: true, status: true, grandTotal: true, refundedTotal: true, shippingAddress: true } },
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
  items: {
    include: {
      orderItem: { select: { id: true, productName: true, variantLabel: true, sku: true, imageUrl: true, unitPrice: true, quantity: true, lineTotal: true, variantId: true, warehouseId: true, productId: true } },
      exchangeVariant: { select: { id: true, sku: true, color: true, size: true } },
    },
  },
  refunds: { select: { id: true, amount: true, status: true, method: true, providerReference: true, processedAt: true } },
} satisfies Prisma.ReturnInclude;
type ReturnFull = Prisma.ReturnGetPayload<{ include: typeof returnInclude }>;

function presentReturn(r: ReturnFull) {
  return {
    returnNumber: r.returnNumber, type: r.type, status: r.status, reason: r.reason, customerNote: r.customerNote, adminNote: r.adminNote,
    createdAt: r.createdAt, approvedAt: r.approvedAt, receivedAt: r.receivedAt, closedAt: r.closedAt,
    refundAmount: r.refundAmount?.toFixed(2) ?? null,
    order: { orderNumber: r.order.orderNumber },
    items: r.items.map((i) => ({
      id: i.id, quantity: i.quantity, condition: i.condition, restock: i.restock,
      name: i.orderItem.productName, variantLabel: i.orderItem.variantLabel, sku: i.orderItem.sku, image: i.orderItem.imageUrl,
      unitPaid: i.orderItem.lineTotal.div(i.orderItem.quantity).toFixed(2),
      exchangeFor: i.exchangeVariant ? { sku: i.exchangeVariant.sku, label: [i.exchangeVariant.color, i.exchangeVariant.size].filter(Boolean).join(' / ') } : null,
    })),
    refunds: r.refunds.map((f) => ({ ...f, amount: f.amount.toFixed(2) })),
  };
}

// ─── Service ───

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  private async windowDays() {
    const s = await this.prisma.systemSetting.findUnique({ where: { group_key: { group: 'orders', key: 'returnWindowDays' } } });
    return Number(s?.value ?? 14);
  }

  private async deliveredAt(orderId: number) {
    const s = await this.prisma.shipment.findFirst({ where: { orderId, deliveredAt: { not: null } }, orderBy: { deliveredAt: 'asc' } });
    if (s?.deliveredAt) return s.deliveredAt;
    const h = await this.prisma.orderStatusHistory.findFirst({ where: { orderId, toStatus: OrderStatus.DELIVERED }, orderBy: { createdAt: 'asc' } });
    return h?.createdAt ?? null;
  }

  /**
   * Units already in an open return, per order line. Summed in code: Prisma's groupBy/aggregate with
   * relation filters emits an ambiguous `quantity` column on MySQL.
   */
  private async pendingByItem(orderItemIds: number[]) {
    const rows = await this.prisma.returnItem.findMany({
      where: { orderItemId: { in: orderItemIds }, return: { status: { in: OPEN_RETURN } } },
      select: { orderItemId: true, quantity: true },
    });
    const m = new Map<number, number>();
    for (const r of rows) m.set(r.orderItemId, (m.get(r.orderItemId) ?? 0) + r.quantity);
    return m;
  }

  /** What a customer may still return on an order, per SKU, and until when. */
  async eligibility(userId: number, orderNumber: string) {
    const order = await this.prisma.order.findFirst({ where: { orderNumber, userId }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found');
    const delivered = await this.deliveredAt(order.id);
    const days = await this.windowDays();
    const deadline = delivered ? new Date(delivered.getTime() + days * DAY) : null;
    const returnable = [OrderStatus.DELIVERED, OrderStatus.COMPLETED, OrderStatus.PARTIALLY_REFUNDED] as OrderStatus[];
    const pending = await this.pendingByItem(order.items.map((i) => i.id));
    const bySku = new Map<string, { sku: string; name: string; variantLabel: string | null; image: string | null; productId: number | null; returnable: number; items: typeof order.items }>();
    for (const i of order.items) {
      const left = i.quantity - i.quantityReturned - (pending.get(i.id) ?? 0);
      const row = bySku.get(i.sku) ?? { sku: i.sku, name: i.productName, variantLabel: i.variantLabel, image: i.imageUrl, productId: i.productId, returnable: 0, items: [] };
      row.returnable += Math.max(0, left);
      row.items.push(i);
      bySku.set(i.sku, row);
    }
    const open_ = returnable.includes(order.status) && !!deadline && deadline > new Date();
    return {
      order, deadline,
      eligible: open_,
      reason: !returnable.includes(order.status) ? 'Returns open once your order has been delivered' : deadline && deadline <= new Date() ? `The ${days}-day return window has closed` : null,
      lines: [...bySku.values()],
    };
  }

  async eligibilityView(userId: number, orderNumber: string) {
    const e = await this.eligibility(userId, orderNumber);
    const variants = await this.prisma.productVariant.findMany({
      where: { productId: { in: e.lines.map((l) => l.productId).filter((x): x is number => !!x) }, isActive: true, deletedAt: null },
      include: { inventory: { select: { quantityOnHand: true, quantityReserved: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    return {
      eligible: e.eligible, reason: e.reason, deadline: e.deadline,
      lines: e.lines.map((l) => ({
        sku: l.sku, name: l.name, variantLabel: l.variantLabel, image: l.image, returnable: l.returnable,
        unitPaid: l.items[0].lineTotal.div(l.items[0].quantity).toFixed(2),
        exchangeOptions: variants.filter((v) => v.productId === l.productId && v.sku !== l.sku).map((v) => ({
          variantId: v.id, sku: v.sku, label: [v.color, v.size].filter(Boolean).join(' / '),
          inStock: v.inventory.some((i) => i.quantityOnHand - i.quantityReserved > 0),
        })),
      })),
    };
  }

  async request(user: AuthUser, orderNumber: string, dto: RequestReturnDto, ctx: RequestContext) {
    const e = await this.eligibility(user.id, orderNumber);
    if (!e.eligible) throw new ConflictException({ message: e.reason ?? 'This order cannot be returned', code: 'NOT_RETURNABLE' });
    const items: Array<{ orderItemId: number; quantity: number; exchangeVariantId: number | null }> = [];
    for (const line of dto.items) {
      const l = e.lines.find((x) => x.sku === line.sku);
      if (!l) throw new BadRequestException(`${line.sku} is not on this order`);
      if (line.quantity > l.returnable) throw new BadRequestException(`You can return up to ${l.returnable} of ${l.name}`);
      let exchangeVariantId: number | null = null;
      if (dto.type === ReturnType.EXCHANGE) {
        if (!line.exchangeVariantId) throw new BadRequestException(`Choose the size or colour you want instead of ${l.name}`);
        const v = await this.prisma.productVariant.findFirst({ where: { id: line.exchangeVariantId, productId: l.productId ?? -1, isActive: true, deletedAt: null } });
        if (!v || v.sku === l.sku) throw new BadRequestException('Exchanges are for a different size or colour of the same item');
        exchangeVariantId = v.id;
      }
      // Spread the quantity across order lines (an item can ship from two warehouses).
      let left = line.quantity;
      const pending = await this.pendingByItem(l.items.map((i) => i.id));
      for (const oi of l.items) {
        if (!left) break;
        const can = oi.quantity - oi.quantityReturned - (pending.get(oi.id) ?? 0);
        const take = Math.min(left, Math.max(0, can));
        if (take) items.push({ orderItemId: oi.id, quantity: take, exchangeVariantId });
        left -= take;
      }
    }
    const r = await this.prisma.$transaction(async (tx) => {
      const created = await tx.return.create({
        data: {
          returnNumber: ref('RT'), orderId: e.order.id, userId: user.id, type: dto.type, reason: dto.reason, customerNote: dto.note,
          items: { create: items },
        },
      });
      await tx.orderStatusHistory.create({ data: { orderId: e.order.id, fromStatus: e.order.status, toStatus: e.order.status, note: `${dto.type === 'EXCHANGE' ? 'Exchange' : 'Return'} ${created.returnNumber} requested`, changedBy: user.id } });
      await this.audit.log({ userId: user.id, action: 'returns.requested', entityType: 'return', entityId: created.returnNumber, newValues: { type: dto.type, reason: dto.reason, items: items.length }, ctx }, tx);
      return created;
    });
    return this.get(r.returnNumber, user.id);
  }

  async get(returnNumber: string, userId?: number) {
    const r = await this.prisma.return.findFirst({ where: { returnNumber, ...(userId && { userId }) }, include: returnInclude });
    if (!r) throw new NotFoundException('Return not found');
    return presentReturn(r);
  }

  async mine(userId: number) {
    const rows = await this.prisma.return.findMany({ where: { userId }, include: returnInclude, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map(presentReturn);
  }

  async withdraw(userId: number, returnNumber: string, ctx: RequestContext) {
    const r = await this.prisma.return.findFirst({ where: { returnNumber, userId } });
    if (!r) throw new NotFoundException('Return not found');
    const claimed = await this.prisma.return.updateMany({ where: { id: r.id, status: ReturnStatus.REQUESTED }, data: { status: ReturnStatus.CLOSED, closedAt: new Date(), adminNote: 'Withdrawn by customer' } });
    if (claimed.count !== 1) throw new ConflictException('This return is already being processed');
    await this.audit.log({ userId, action: 'returns.withdrawn', entityType: 'return', entityId: returnNumber, ctx });
    return this.get(returnNumber, userId);
  }

  // ─── Staff ───

  async list(q: ReturnQuery) {
    const where: Prisma.ReturnWhereInput = {
      status: q.status, type: q.type,
      ...(q.q?.trim() && { OR: [{ returnNumber: { contains: q.q.trim().toUpperCase() } }, { order: { orderNumber: { contains: q.q.trim().toUpperCase() } } }, { user: { email: { contains: q.q.trim() } } }] }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.return.findMany({ where, include: returnInclude, orderBy: { createdAt: q.order }, skip: q.skip, take: q.pageSize }),
      this.prisma.return.count({ where }),
    ]);
    return new Paginated(rows.map((r) => ({ ...presentReturn(r), customer: r.user ? `${r.user.firstName} ${r.user.lastName}` : r.order.guestEmail })), total, q);
  }

  private async transition(user: AuthUser, returnNumber: string, from: ReturnStatus[], data: Prisma.ReturnUpdateManyMutationInput, action: string, ctx: RequestContext, extra?: Prisma.InputJsonValue) {
    const r = await this.prisma.return.findUnique({ where: { returnNumber } });
    if (!r) throw new NotFoundException('Return not found');
    const claimed = await this.prisma.return.updateMany({ where: { id: r.id, status: { in: from } }, data });
    if (claimed.count !== 1) throw new ConflictException(`This return is ${r.status.toLowerCase().replace('_', ' ')} and can't be changed that way`);
    await this.audit.log({ userId: user.id, action, entityType: 'return', entityId: returnNumber, oldValues: { status: r.status }, newValues: extra, ctx });
    return this.get(returnNumber);
  }

  approve(user: AuthUser, n: string, note: string | undefined, ctx: RequestContext) {
    return this.transition(user, n, [ReturnStatus.REQUESTED], { status: ReturnStatus.APPROVED, approvedAt: new Date(), adminNote: note ?? 'Approved. Hand the item(s) to a VÉLORA rider or drop them at our Spintex store, with the order number.' }, 'returns.approved', ctx);
  }

  reject(user: AuthUser, n: string, reason: string, ctx: RequestContext) {
    return this.transition(user, n, [ReturnStatus.REQUESTED, ReturnStatus.APPROVED], { status: ReturnStatus.REJECTED, adminNote: reason, closedAt: new Date() }, 'returns.rejected', ctx, { reason });
  }

  /**
   * Goods are back: restock resellable units, then settle. Refunds become a Finance refund request for
   * exactly what was paid for those units; exchanges become a free replacement order with stock reserved.
   */
  async receive(user: AuthUser, returnNumber: string, dto: ReceiveDto, ctx: RequestContext) {
    const r = await this.prisma.return.findUnique({ where: { returnNumber }, include: { ...returnInclude, order: true } });
    if (!r) throw new NotFoundException('Return not found');
    if (r.status !== ReturnStatus.APPROVED) throw new ConflictException('Approve the return before receiving items');
    const resolution = r.type === ReturnType.EXCHANGE ? (dto.resolution ?? 'EXCHANGE') : 'REFUND';
    const conditions = new Map(dto.items.map((i) => [i.returnItemId, i.condition]));
    if (r.items.some((i) => !conditions.has(i.id))) throw new BadRequestException('Record the condition of every item');
    const defaultWh = await this.prisma.warehouse.findFirst({ where: { isDefault: true, deletedAt: null } });

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.return.updateMany({ where: { id: r.id, status: ReturnStatus.APPROVED }, data: { status: ReturnStatus.ITEMS_RECEIVED, receivedAt: new Date(), adminNote: dto.note ?? r.adminNote } });
      if (claimed.count !== 1) throw new ConflictException('This return was just received by someone else');

      for (const i of r.items) {
        const resellable = conditions.get(i.id) === 'RESELLABLE';
        await tx.returnItem.update({ where: { id: i.id }, data: { condition: conditions.get(i.id), restock: resellable } });
        await tx.orderItem.update({ where: { id: i.orderItem.id }, data: { quantityReturned: { increment: i.quantity } } });
        const wh = i.orderItem.warehouseId ?? defaultWh?.id;
        if (resellable && i.orderItem.variantId && wh) {
          await this.inventory.returnToStock(tx, { variantId: i.orderItem.variantId, warehouseId: wh, quantity: i.quantity, returnId: r.id, userId: user.id });
        }
        if (i.orderItem.productId) await tx.product.update({ where: { id: i.orderItem.productId }, data: { soldCount: { decrement: i.quantity } } });
      }

      if (resolution === 'REFUND') {
        const owed = r.items.reduce((s, i) => s.add(i.orderItem.lineTotal.div(i.orderItem.quantity).mul(i.quantity)), new Prisma.Decimal(0)).toDecimalPlaces(2);
        const openRefunds = await tx.refund.aggregate({ where: { orderId: r.order.id, status: { in: [RefundStatus.REQUESTED, RefundStatus.APPROVED, RefundStatus.PROCESSING] } }, _sum: { amount: true } });
        const ceiling = r.order.grandTotal.sub(r.order.refundedTotal).sub(openRefunds._sum.amount ?? 0);
        const amount = Prisma.Decimal.max(0, Prisma.Decimal.min(owed, ceiling));
        const payment = await tx.payment.findFirst({ where: { orderId: r.order.id, status: PaymentTxnStatus.SUCCESS }, orderBy: { createdAt: 'desc' } });
        await tx.return.update({ where: { id: r.id }, data: { refundAmount: amount } });
        if (amount.gt(0)) {
          await tx.refund.create({ data: { orderId: r.order.id, paymentId: payment?.id, returnId: r.id, amount, reason: `Return ${r.returnNumber}: ${r.reason.toLowerCase().replace(/_/g, ' ')}`, status: RefundStatus.REQUESTED } });
        }
      } else {
        // Exchange: a no-charge replacement order with the new size/colour reserved for dispatch.
        const lines = r.items.filter((i) => i.exchangeVariant);
        if (lines.length !== r.items.length) throw new BadRequestException('Every exchanged item needs a replacement size or colour');
        const variants = await tx.productVariant.findMany({ where: { id: { in: lines.map((l) => l.exchangeVariant!.id) } }, include: { product: { select: { id: true, name: true, vendorId: true, images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } } } } } });
        const replacement = await tx.order.create({
          data: {
            orderNumber: ref('VLX'), userId: r.order.userId, guestEmail: r.order.guestEmail, guestPhone: r.order.guestPhone,
            status: OrderStatus.PROCESSING, paymentStatus: PaymentStatus.PAID, subtotal: 0, grandTotal: 0, shippingTotal: 0,
            shippingMethodId: r.order.shippingMethodId, shippingAddress: r.order.shippingAddress as Prisma.InputJsonValue,
            customerNote: `Exchange for ${r.returnNumber} (order ${r.order.orderNumber})`, idempotencyKey: `exchange-${r.id}`, channel: 'exchange', paidAt: new Date(),
          },
        });
        const allocations = await this.inventory.reserve(tx, lines.map((l) => ({ variantId: l.exchangeVariant!.id, quantity: l.quantity, sku: l.exchangeVariant!.sku })), { orderId: replacement.id, userId: user.id })
          .catch((e) => {
            throw new ConflictException({ message: `${(e as { response?: { message?: string } }).response?.message ?? 'Replacement is out of stock'} Settle this return as a refund instead.`, code: 'EXCHANGE_OUT_OF_STOCK' });
          });
        for (const a of allocations) {
          const v = variants.find((x) => x.id === a.variantId)!;
          const src = lines.find((l) => l.exchangeVariant!.id === a.variantId)!;
          await tx.orderItem.create({
            data: {
              orderId: replacement.id, productId: v.product.id, variantId: v.id, vendorId: v.product.vendorId, warehouseId: a.warehouseId,
              productName: v.product.name, variantLabel: [v.color, v.size].filter(Boolean).join(' / '), sku: v.sku, imageUrl: v.product.images[0]?.url,
              unitPrice: src.orderItem.unitPrice, quantity: a.quantity, discountAmount: src.orderItem.unitPrice.mul(a.quantity), lineTotal: 0,
            },
          });
        }
        await tx.payment.create({ data: { orderId: replacement.id, provider: 'CASH_ON_DELIVERY', method: 'CASH', reference: `EXC-${replacement.orderNumber}`, amount: 0, status: PaymentTxnStatus.SUCCESS, verifiedAt: new Date() } });
        await tx.orderStatusHistory.create({ data: { orderId: replacement.id, toStatus: OrderStatus.PROCESSING, note: `Exchange for return ${r.returnNumber}. Nothing to pay.`, changedBy: user.id } });
        await tx.return.update({ where: { id: r.id }, data: { status: ReturnStatus.EXCHANGED, exchangeOrderId: replacement.id, closedAt: new Date() } });
      }
      await tx.orderStatusHistory.create({ data: { orderId: r.order.id, fromStatus: r.order.status, toStatus: r.order.status, note: `Return ${r.returnNumber} received (${resolution === 'REFUND' ? 'refund pending' : 'exchange sent'})`, changedBy: user.id } });
      await this.audit.log({ userId: user.id, action: 'returns.received', entityType: 'return', entityId: r.returnNumber, newValues: { resolution, conditions: Object.fromEntries(conditions) }, ctx }, tx);
    }, { timeout: 30_000 });
    return this.get(returnNumber);
  }

  // ─── Finance: refunds ───

  async refunds(q: RefundQuery) {
    const where: Prisma.RefundWhereInput = {
      status: q.status,
      ...(q.q?.trim() && { order: { orderNumber: { contains: q.q.trim().toUpperCase() } } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.refund.findMany({
        where, orderBy: { createdAt: q.order }, skip: q.skip, take: q.pageSize,
        include: {
          order: { select: { orderNumber: true, guestEmail: true, guestPhone: true, grandTotal: true } },
          payment: { select: { reference: true, provider: true, method: true, payerPhone: true, cardLast4: true } },
          return: { select: { returnNumber: true } },
          processedBy: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.refund.count({ where }),
    ]);
    return new Paginated(rows.map((r) => ({
      ...r, amount: r.amount.toFixed(2), order: { ...r.order, grandTotal: r.order.grandTotal.toFixed(2) },
      processedBy: r.processedBy ? `${r.processedBy.firstName} ${r.processedBy.lastName}` : null,
      gatewayRefundable: !!r.payment && r.payment.provider !== 'CASH_ON_DELIVERY' && !!this.payments.gateway(r.payment.provider)?.apiRefunds,
    })), total, q);
  }

  async processRefund(user: AuthUser, id: number, dto: ProcessRefundDto, ctx: RequestContext) {
    const refund = await this.prisma.refund.findUnique({ where: { id }, include: { payment: true } });
    if (!refund) throw new NotFoundException('Refund not found');
    if (refund.status !== RefundStatus.REQUESTED && refund.status !== RefundStatus.APPROVED) throw new ConflictException(`This refund is already ${refund.status.toLowerCase()}`);

    if (dto.mode === 'GATEWAY') {
      const gw = refund.payment && refund.payment.status === PaymentTxnStatus.SUCCESS ? this.payments.gateway(refund.payment.provider) : null;
      if (!gw?.apiRefunds || !gw.refund) throw new BadRequestException('This payment cannot be refunded through the provider. Pay out manually and record the reference.');
      // Claim first so two clicks can't send two provider refunds.
      const claimed = await this.prisma.refund.updateMany({ where: { id, status: { in: [RefundStatus.REQUESTED, RefundStatus.APPROVED] } }, data: { status: RefundStatus.PROCESSING, method: 'ORIGINAL', note: dto.note, processedById: user.id } });
      if (claimed.count !== 1) throw new ConflictException('This refund is already being processed');
      let result;
      try {
        result = await gw.refund(refund.payment!.reference, refund.amount);
      } catch (e) {
        await this.prisma.refund.update({ where: { id }, data: { status: RefundStatus.APPROVED } });
        throw e;
      }
      if (result.status === 'completed') await this.prisma.$transaction((tx) => this.lifecycle.completeRefund(tx, id, user.id, result.providerReference));
      else await this.prisma.refund.update({ where: { id }, data: { providerReference: result.providerReference } });
    } else {
      if (!dto.method || !dto.reference) throw new BadRequestException({ message: 'Choose the payout method and enter its reference', code: 'VALIDATION_FAILED', details: [{ field: 'reference', messages: ['Required for manual payouts'] }] });
      await this.prisma.$transaction(async (tx) => {
        await tx.refund.update({ where: { id }, data: { method: dto.method, note: dto.note } });
        const done = await this.lifecycle.completeRefund(tx, id, user.id, `${dto.method}:${dto.reference}`);
        if (!done) throw new ConflictException('This refund was completed by someone else just now');
      });
    }
    await this.audit.log({ userId: user.id, action: 'refunds.processed', entityType: 'refund', entityId: id, newValues: { mode: dto.mode, method: dto.method, reference: dto.reference, amount: refund.amount.toFixed(2) }, ctx });
    return this.prisma.refund.findUniqueOrThrow({ where: { id } }).then((r) => ({ ...r, amount: r.amount.toFixed(2) }));
  }

  async rejectRefund(user: AuthUser, id: number, reason: string, ctx: RequestContext) {
    const claimed = await this.prisma.refund.updateMany({ where: { id, status: { in: [RefundStatus.REQUESTED, RefundStatus.APPROVED] } }, data: { status: RefundStatus.REJECTED, note: reason, processedById: user.id, processedAt: new Date() } });
    if (claimed.count !== 1) throw new ConflictException('Only pending refunds can be rejected');
    const r = await this.prisma.refund.findUniqueOrThrow({ where: { id } });
    if (r.returnId) await this.prisma.return.update({ where: { id: r.returnId }, data: { status: ReturnStatus.CLOSED, closedAt: new Date(), adminNote: `Refund declined: ${reason}` } });
    await this.audit.log({ userId: user.id, action: 'refunds.rejected', entityType: 'refund', entityId: id, newValues: { reason }, ctx });
    return { ...r, amount: r.amount.toFixed(2) };
  }

  // ─── Finance: payments ledger ───

  async paymentsLedger(q: PaymentQuery) {
    const where: Prisma.PaymentWhereInput = {
      status: q.status,
      ...(q.provider && { provider: q.provider as never }),
      ...(q.q?.trim() && { OR: [{ reference: { contains: q.q.trim().toUpperCase() } }, { order: { orderNumber: { contains: q.q.trim().toUpperCase() } } }, { providerReference: { contains: q.q.trim() } }] }),
    };
    const [rows, total, sums] = await Promise.all([
      this.prisma.payment.findMany({
        where, orderBy: { createdAt: q.order }, skip: q.skip, take: q.pageSize,
        select: { id: true, reference: true, providerReference: true, provider: true, method: true, amount: true, currency: true, status: true,
          failureReason: true, cardLast4: true, cardBrand: true, payerPhone: true, verifiedAt: true, createdAt: true, order: { select: { orderNumber: true, status: true } } },
      }),
      this.prisma.payment.count({ where }),
      this.prisma.payment.groupBy({ by: ['provider'], where: { status: PaymentTxnStatus.SUCCESS }, _sum: { amount: true }, _count: { _all: true } }),
    ]);
    const page = new Paginated(rows.map((p) => ({ ...p, amount: p.amount.toFixed(2) })), total, q);
    return { items: page.items, meta: page.meta, settledByProvider: sums.map((s) => ({ provider: s.provider, count: s._count._all, amount: (s._sum.amount ?? new Prisma.Decimal(0)).toFixed(2) })) };
  }

  webhookEvents() {
    return this.prisma.webhookEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, provider: true, eventId: true, eventType: true, signatureOk: true, processedAt: true, error: true, createdAt: true } });
  }
}

// ─── Controllers ───

@ApiTags('My account · Returns')
@ApiBearerAuth()
@Controller('me')
export class CustomerReturnsController {
  constructor(private readonly svc: ReturnsService) {}

  @Get('orders/:number/returnable')
  returnable(@CurrentUser() u: AuthUser, @Param('number') n: string) { return this.svc.eligibilityView(u.id, n); }

  @Post('orders/:number/returns')
  request(@CurrentUser() u: AuthUser, @Param('number') n: string, @Body() dto: RequestReturnDto, @Req() r: Request) { return this.svc.request(u, n, dto, requestContext(r)); }

  @Get('returns')
  mine(@CurrentUser() u: AuthUser) { return this.svc.mine(u.id); }

  @Get('returns/:number')
  get(@CurrentUser() u: AuthUser, @Param('number') n: string) { return this.svc.get(n, u.id); }

  @Post('returns/:number/withdraw') @HttpCode(200)
  withdraw(@CurrentUser() u: AuthUser, @Param('number') n: string, @Req() r: Request) { return this.svc.withdraw(u.id, n, requestContext(r)); }
}

@ApiTags('Admin · Returns, refunds & payments')
@ApiBearerAuth()
@Controller('admin')
export class AdminReturnsController {
  constructor(
    private readonly svc: ReturnsService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('returns') @RequirePermissions(PERMISSIONS.RETURNS_VIEW)
  list(@Query() q: ReturnQuery) { return this.svc.list(q); }

  @Get('returns/:number') @RequirePermissions(PERMISSIONS.RETURNS_VIEW)
  get(@Param('number') n: string) { return this.svc.get(n); }

  @Post('returns/:number/approve') @HttpCode(200) @RequirePermissions(PERMISSIONS.RETURNS_MANAGE)
  approve(@Param('number') n: string, @Body() dto: NoteDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.approve(u, n, dto.note, requestContext(r)); }

  @Post('returns/:number/reject') @HttpCode(200) @RequirePermissions(PERMISSIONS.RETURNS_MANAGE)
  reject(@Param('number') n: string, @Body() dto: ReasonDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.reject(u, n, dto.reason, requestContext(r)); }

  @Post('returns/:number/receive') @HttpCode(200) @RequirePermissions(PERMISSIONS.RETURNS_MANAGE)
  receive(@Param('number') n: string, @Body() dto: ReceiveDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.receive(u, n, dto, requestContext(r)); }

  @Get('refunds') @RequirePermissions(PERMISSIONS.REFUNDS_PROCESS)
  refunds(@Query() q: RefundQuery) { return this.svc.refunds(q); }

  @Post('refunds/:id/process') @HttpCode(200) @RequirePermissions(PERMISSIONS.REFUNDS_PROCESS)
  process(@Param('id', ParseIntPipe) id: number, @Body() dto: ProcessRefundDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.processRefund(u, id, dto, requestContext(r)); }

  @Post('refunds/:id/reject') @HttpCode(200) @RequirePermissions(PERMISSIONS.REFUNDS_PROCESS)
  rejectRefund(@Param('id', ParseIntPipe) id: number, @Body() dto: ReasonDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.rejectRefund(u, id, dto.reason, requestContext(r)); }

  @Get('payments') @RequirePermissions(PERMISSIONS.PAYMENTS_VIEW)
  ledger(@Query() q: PaymentQuery) { return this.svc.paymentsLedger(q); }

  @Get('payments/webhook-events') @RequirePermissions(PERMISSIONS.PAYMENTS_VIEW)
  events() { return this.svc.webhookEvents(); }

  /** Run the unpaid-order expiry now (it also runs every minute in the background). */
  @Post('payments/sweep') @HttpCode(200) @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  sweep(@Body() _dto: SweepDto) { return this.payments.sweep(); }
}

@Module({ controllers: [CustomerReturnsController, AdminReturnsController], providers: [ReturnsService] })
export class ReturnsModule {}
