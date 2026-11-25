import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseIntPipe, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  CommissionStatus, OrderStatus, PaymentStatus, PaymentTxnStatus, Prisma, ShipmentStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { PERMISSIONS, type AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';
import { requestContext } from '../../common/utils/request';
import type { RequestContext } from '../../common/types';
import { AuditService } from '../audit/audit.module';
import { InventoryService } from '../inventory/inventory.service';
import { orderInclude, presentOrder } from '../orders/order-presenter';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class AdminOrderQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: OrderStatus }) @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @ApiPropertyOptional({ enum: PaymentStatus }) @IsOptional() @IsEnum(PaymentStatus) paymentStatus?: PaymentStatus;
  @ApiPropertyOptional({ enum: ['open'], description: '"open" = needs action (being prepared or shipped)' }) @IsOptional() @IsIn(['open']) view?: 'open';
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ enum: ['web', 'mobile'] }) @IsOptional() @IsIn(['web', 'mobile']) channel?: string;
}

class ShipDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) carrier: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^[A-Za-z0-9-]{4,80}$/, { message: 'Tracking numbers use letters, numbers and dashes' }) trackingNumber?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) riderName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @Matches(/^\+233[2-5]\d{8}$/, { message: 'Enter a Ghana mobile number like +233241234567' }) riderPhone?: string;
}

class ReasonDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3, { message: 'Give a reason' }) @MaxLength(255) reason: string;
}

class ShipmentEventDto {
  @ApiProperty({ enum: ShipmentStatus }) @IsEnum(ShipmentStatus) status: ShipmentStatus;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(255) description: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(150) location?: string;
}

class NoteDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(500) note: string;
}

const SHIPPABLE: OrderStatus[] = [OrderStatus.PAID, OrderStatus.PROCESSING];
const CANCELLABLE: OrderStatus[] = [OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, OrderStatus.PROCESSING];

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  async list(q: AdminOrderQuery) {
    const and: Prisma.OrderWhereInput[] = [];
    if (q.status) and.push({ status: q.status });
    if (q.view === 'open') and.push({ status: { in: ['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED', 'PARTIALLY_SHIPPED'] } });
    if (q.paymentStatus) and.push({ paymentStatus: q.paymentStatus });
    if (q.channel) and.push({ channel: q.channel });
    if (q.from) and.push({ placedAt: { gte: new Date(q.from) } });
    if (q.to) and.push({ placedAt: { lt: new Date(new Date(q.to).getTime() + 86_400_000) } });
    if (q.q?.trim()) {
      const t = q.q.trim();
      and.push({ OR: [
        { orderNumber: { contains: t.toUpperCase() } }, { guestEmail: { contains: t } }, { guestPhone: { contains: t } },
        { user: { OR: [{ firstName: { contains: t } }, { lastName: { contains: t } }, { email: { contains: t } }] } },
        { items: { some: { sku: { contains: t.toUpperCase() } } } },
      ] });
    }
    const where: Prisma.OrderWhereInput = { AND: and };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where, orderBy: { placedAt: q.order }, skip: q.skip, take: q.pageSize,
        select: {
          orderNumber: true, status: true, paymentStatus: true, grandTotal: true, currency: true, placedAt: true, channel: true,
          guestEmail: true, shippingAddress: true, userId: true,
          items: { select: { quantity: true } },
          payments: { take: 1, orderBy: { createdAt: 'desc' }, select: { method: true } },
          shippingMethod: { select: { name: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return new Paginated(rows.map((o) => {
      const a = o.shippingAddress as { recipientName?: string; city?: string; region?: string } | null;
      return {
        orderNumber: o.orderNumber, status: o.status, paymentStatus: o.paymentStatus, grandTotal: o.grandTotal.toFixed(2), currency: o.currency,
        placedAt: o.placedAt, channel: o.channel, customer: a?.recipientName ?? o.guestEmail, email: o.guestEmail, isGuest: !o.userId,
        destination: [a?.city, a?.region].filter(Boolean).join(', '), items: o.items.reduce((s, i) => s + i.quantity, 0),
        paymentMethod: o.payments[0]?.method ?? null, shippingMethod: o.shippingMethod?.name ?? null,
      };
    }), total, q);
  }

  private async load(orderNumber: string) {
    const o = await this.prisma.order.findUnique({
      where: { orderNumber },
      include: {
        ...orderInclude,
        items: { orderBy: { id: 'asc' }, include: { product: { select: { slug: true, id: true } }, warehouse: { select: { code: true, name: true } }, vendor: { select: { businessName: true } } } },
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, customer: { select: { orderCount: true, lifetimeValue: true } } } },
        shipments: { include: { events: { orderBy: { occurredAt: 'desc' } } } },
        refunds: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!o) throw new NotFoundException('Order not found');
    return o;
  }

  async get(orderNumber: string) {
    const o = await this.load(orderNumber);
    const changers = await this.prisma.user.findMany({
      where: { id: { in: o.statusHistory.map((h) => h.changedBy).filter((x): x is number => !!x) } },
      select: { id: true, firstName: true, lastName: true },
    });
    const who = new Map(changers.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
    return {
      ...presentOrder(o),
      id: o.id,
      channel: o.channel,
      customerNote: o.customerNote,
      guestPhone: o.guestPhone,
      customer: o.user ? { ...o.user, customer: o.user.customer && { orderCount: o.user.customer.orderCount, lifetimeValue: o.user.customer.lifetimeValue.toFixed(2) } } : null,
      lines: o.items.map((i) => ({
        id: i.id, name: i.productName, variantLabel: i.variantLabel, sku: i.sku, image: i.imageUrl, productId: i.product?.id ?? null,
        unitPrice: i.unitPrice.toFixed(2), quantity: i.quantity, discount: i.discountAmount.toFixed(2), lineTotal: i.lineTotal.toFixed(2),
        warehouse: i.warehouse?.code ?? null, vendor: i.vendor?.businessName ?? null,
      })),
      payments: o.payments,
      shipmentsFull: o.shipments.map((s) => ({ id: s.id, carrier: s.carrier, trackingNumber: s.trackingNumber, status: s.status, riderName: s.riderName,
        riderPhone: s.riderPhone, dispatchedAt: s.dispatchedAt, deliveredAt: s.deliveredAt, events: s.events })),
      refunds: o.refunds.map((r) => ({ ...r, amount: r.amount.toFixed(2) })),
      historyFull: o.statusHistory.map((h) => ({ status: h.toStatus, from: h.fromStatus, note: h.note, at: h.createdAt, by: h.changedBy ? who.get(h.changedBy) ?? 'Staff' : null })),
      can: {
        ship: SHIPPABLE.includes(o.status),
        deliver: o.status === OrderStatus.SHIPPED,
        cancel: CANCELLABLE.includes(o.status),
      },
    };
  }

  private async transition(tx: Prisma.TransactionClient, order: { id: number; status: OrderStatus }, to: OrderStatus, allowed: OrderStatus[], userId: number, note: string, extra: Prisma.OrderUpdateManyMutationInput = {}) {
    const claimed = await tx.order.updateMany({ where: { id: order.id, status: { in: allowed } }, data: { status: to, ...extra } });
    if (claimed.count !== 1) throw new ConflictException('This order changed while you were working on it. Refresh and try again.');
    await tx.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: to, note, changedBy: userId } });
  }

  /** Dispatch: reserved stock becomes a sale, a shipment with tracking is created. */
  async ship(user: AuthUser, orderNumber: string, dto: ShipDto, ctx: RequestContext) {
    const o = await this.load(orderNumber);
    if (!SHIPPABLE.includes(o.status)) throw new ConflictException(`An order that is ${o.status.toLowerCase().replace('_', ' ')} can't be dispatched`);
    if (dto.trackingNumber && (await this.prisma.shipment.findUnique({ where: { trackingNumber: dto.trackingNumber } }))) {
      throw new ConflictException('That tracking number is already used on another shipment');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, o, OrderStatus.SHIPPED, SHIPPABLE, user.id, `Dispatched with ${dto.carrier}${dto.trackingNumber ? ` · ${dto.trackingNumber}` : ''}`);
      await this.inventory.fulfilOrder(tx, o.id, user.id);
      await tx.shipment.create({
        data: {
          orderId: o.id, carrier: dto.carrier, trackingNumber: dto.trackingNumber ?? `VD${o.orderNumber.slice(2)}`, status: ShipmentStatus.DISPATCHED,
          riderName: dto.riderName, riderPhone: dto.riderPhone, dispatchedAt: new Date(),
          warehouseId: o.items.find((i) => i.warehouseId)?.warehouseId ?? null,
          events: { create: { status: ShipmentStatus.DISPATCHED, description: `Handed to ${dto.carrier}` } },
        },
      });
      await this.audit.log({ userId: user.id, action: 'orders.shipped', entityType: 'order', entityId: o.orderNumber, newValues: { ...dto }, ctx }, tx);
    }, { timeout: 20_000 });
    return this.get(orderNumber);
  }

  /** Delivery confirmed: cash collected, revenue recognised, loyalty earned, vendor earnings start their hold period. */
  async deliver(user: AuthUser, orderNumber: string, ctx: RequestContext) {
    const o = await this.load(orderNumber);
    if (o.status !== OrderStatus.SHIPPED) throw new ConflictException('Only shipped orders can be marked delivered');
    const settings = await this.prisma.systemSetting.findMany({ where: { OR: [{ group: 'loyalty' }, { group: 'marketplace' }] } });
    const setting = (g: string, k: string, d: number) => Number(settings.find((s) => s.group === g && s.key === k)?.value ?? d);
    const holdDays = setting('marketplace', 'settlementHoldDays', 14);
    const pointsPerCedi = setting('loyalty', 'pointsPerCedi', 1);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const cod = o.payments.some((p) => p.method === 'CASH');
      await this.transition(tx, o, OrderStatus.DELIVERED, [OrderStatus.SHIPPED], user.id, cod ? 'Delivered and paid to the rider' : 'Delivered',
        cod ? { paymentStatus: PaymentStatus.PAID, paidAt: now } : {});
      await tx.shipment.updateMany({ where: { orderId: o.id, status: { not: ShipmentStatus.DELIVERED } }, data: { status: ShipmentStatus.DELIVERED, deliveredAt: now } });
      for (const s of o.shipments) await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: ShipmentStatus.DELIVERED, description: 'Delivered to customer' } });
      if (cod) {
        await tx.payment.updateMany({ where: { orderId: o.id, method: 'CASH', status: { in: [PaymentTxnStatus.PENDING, PaymentTxnStatus.INITIATED] } }, data: { status: PaymentTxnStatus.SUCCESS, verifiedAt: now } });
      }
      for (const i of o.items) if (i.productId) await tx.product.update({ where: { id: i.productId }, data: { soldCount: { increment: i.quantity } } });
      await tx.vendorCommission.updateMany({
        where: { orderItem: { orderId: o.id }, status: CommissionStatus.PENDING },
        data: { status: CommissionStatus.ELIGIBLE, eligibleAt: new Date(now.getTime() + holdDays * 86_400_000) },
      });
      if (o.userId) {
        await tx.customer.updateMany({ where: { userId: o.userId }, data: { lifetimeValue: { increment: o.grandTotal } } });
        const points = Math.floor(Number(o.grandTotal.sub(o.shippingTotal)) * pointsPerCedi);
        if (points > 0) {
          const acct = await tx.loyaltyAccount.upsert({ where: { userId: o.userId }, create: { userId: o.userId }, update: {} });
          const updated = await tx.loyaltyAccount.update({ where: { id: acct.id }, data: { pointsBalance: { increment: points }, lifetimePoints: { increment: points } } });
          const tier = updated.lifetimePoints >= 20000 ? 'PLATINUM' : updated.lifetimePoints >= 8000 ? 'GOLD' : updated.lifetimePoints >= 2500 ? 'SILVER' : 'BRONZE';
          if (tier !== updated.tier) await tx.loyaltyAccount.update({ where: { id: acct.id }, data: { tier } });
          await tx.loyaltyTransaction.create({ data: { accountId: acct.id, type: 'EARN', points, balanceAfter: updated.pointsBalance, orderId: o.id, description: `Order ${o.orderNumber}` } });
        }
      }
      await this.audit.log({ userId: user.id, action: 'orders.delivered', entityType: 'order', entityId: o.orderNumber, ctx }, tx);
    }, { timeout: 20_000 });
    return this.get(orderNumber);
  }

  async cancel(user: AuthUser, orderNumber: string, reason: string, ctx: RequestContext) {
    const o = await this.load(orderNumber);
    if (!CANCELLABLE.includes(o.status)) throw new ConflictException('Dispatched or completed orders cannot be cancelled. Use a return instead.');
    await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.cancel(tx, o.id, { by: user.id, reason, historyNote: `Cancelled by VÉLORA: ${reason}` });
      await this.audit.log({ userId: user.id, action: 'orders.cancelled', entityType: 'order', entityId: o.orderNumber, newValues: { reason }, ctx }, tx);
    }, { timeout: 20_000 });
    return this.get(orderNumber);
  }

  async addNote(user: AuthUser, orderNumber: string, note: string, ctx: RequestContext) {
    const o = await this.load(orderNumber);
    await this.prisma.orderStatusHistory.create({ data: { orderId: o.id, fromStatus: o.status, toStatus: o.status, note: `Note: ${note}`, changedBy: user.id } });
    await this.audit.log({ userId: user.id, action: 'orders.note_added', entityType: 'order', entityId: o.orderNumber, ctx });
    return this.get(orderNumber);
  }

  async shipmentEvent(user: AuthUser, shipmentId: number, dto: ShipmentEventDto, ctx: RequestContext) {
    const s = await this.prisma.shipment.findUnique({ where: { id: shipmentId }, include: { order: { select: { orderNumber: true, status: true } } } });
    if (!s) throw new NotFoundException('Shipment not found');
    if (dto.status === ShipmentStatus.DELIVERED) throw new BadRequestException('Use "Mark delivered" on the order so payment and loyalty are recorded');
    if (s.order.status !== OrderStatus.SHIPPED) throw new ConflictException('Tracking updates are only possible while the order is in transit');
    await this.prisma.$transaction([
      this.prisma.shipmentEvent.create({ data: { shipmentId, status: dto.status, description: dto.description, location: dto.location } }),
      this.prisma.shipment.update({ where: { id: shipmentId }, data: { status: dto.status } }),
    ]);
    await this.audit.log({ userId: user.id, action: 'shipments.event', entityType: 'shipment', entityId: shipmentId, newValues: { ...dto }, ctx });
    return this.get(s.order.orderNumber);
  }
}

@ApiTags('Admin · Orders')
@ApiBearerAuth()
@Controller('admin')
export class AdminOrdersController {
  constructor(private readonly svc: AdminOrdersService) {}

  @Get('orders') @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  list(@Query() q: AdminOrderQuery) { return this.svc.list(q); }

  @Get('orders/:number') @RequirePermissions(PERMISSIONS.ORDERS_VIEW)
  get(@Param('number') n: string) { return this.svc.get(n); }

  @Post('orders/:number/ship') @HttpCode(200) @RequirePermissions(PERMISSIONS.SHIPMENTS_MANAGE)
  ship(@Param('number') n: string, @Body() dto: ShipDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.ship(u, n, dto, requestContext(r)); }

  @Post('orders/:number/deliver') @HttpCode(200) @RequirePermissions(PERMISSIONS.SHIPMENTS_MANAGE)
  deliver(@Param('number') n: string, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.deliver(u, n, requestContext(r)); }

  @Post('orders/:number/cancel') @HttpCode(200) @RequirePermissions(PERMISSIONS.ORDERS_CANCEL)
  cancel(@Param('number') n: string, @Body() dto: ReasonDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.cancel(u, n, dto.reason, requestContext(r)); }

  @Post('orders/:number/notes') @HttpCode(200) @RequirePermissions(PERMISSIONS.ORDERS_MANAGE)
  note(@Param('number') n: string, @Body() dto: NoteDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.addNote(u, n, dto.note, requestContext(r)); }

  @Post('shipments/:id/events') @HttpCode(200) @RequirePermissions(PERMISSIONS.SHIPMENTS_MANAGE)
  event(@Param('id', ParseIntPipe) id: number, @Body() dto: ShipmentEventDto, @CurrentUser() u: AuthUser, @Req() r: Request) {
    return this.svc.shipmentEvent(u, id, dto, requestContext(r));
  }
}

@Module({ controllers: [AdminOrdersController], providers: [AdminOrdersService] })
export class AdminOrdersModule {}

