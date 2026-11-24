import {
  BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpCode, Injectable, Module,
  NotFoundException, Post, Query,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CartStatus, CommissionStatus, OrderStatus, PaymentMethod, PaymentProvider, PaymentStatus, PaymentTxnStatus, Prisma,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { GHANA_REGIONS } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators';
import { requireViewer, Viewer, type ViewerRef } from '../../common/viewer';
import { CartModule, CartService } from '../cart/cart.module';
import { fmt, PricingService } from '../cart/pricing.service';
import { InventoryService } from '../inventory/inventory.service';
import { orderInclude, presentOrder } from '../orders/order-presenter';
import { AddressInput, LookupDto, PlaceOrderDto, QuoteDto } from './checkout.dto';

class RegionQuery {
  @ApiProperty({ enum: GHANA_REGIONS }) @IsIn(GHANA_REGIONS as unknown as string[], { message: 'Choose a region' })
  region: string;
}

const IDEMPOTENCY_RULE = /^[A-Za-z0-9_-]{16,64}$/;

function orderNumber() {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  // 5 chars of base32-ish randomness without look-alikes (0/O, 1/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rand = [...randomBytes(5)].map((b) => alphabet[b % alphabet.length]).join('');
  return `VL${ymd}${rand}`;
}

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly cart: CartService,
    private readonly inventory: InventoryService,
  ) {}

  private async pricedCart(v: ViewerRef, email: string | null) {
    const cart = await this.cart.find(v);
    if (!cart || !cart.items.length) throw new BadRequestException({ message: 'Your bag is empty', code: 'CART_EMPTY' });
    const lines = cart.items.map((i) => this.pricing.priceLine(i));
    const subtotal = this.pricing.subtotal(lines);
    const coupon = cart.coupon ? await this.pricing.evaluateCoupon(cart.coupon, { subtotal, userId: v.userId, email }) : null;
    return { cart, lines, subtotal, coupon };
  }

  async shippingOptions(v: ViewerRef, region: string) {
    const { subtotal, coupon } = await this.pricedCart(v, v.email);
    const discount = coupon?.valid ? coupon.discount : new Prisma.Decimal(0);
    const options = await this.pricing.shippingOptions(region, subtotal.sub(discount), !!coupon?.valid && coupon.freeShipping);
    return options.map((o) => ({ ...o, baseFee: fmt(o.baseFee), fee: fmt(o.fee), freeOver: fmt(o.freeOver) }));
  }

  async quote(v: ViewerRef, dto: QuoteDto) {
    const email = v.email ?? dto.email ?? null;
    const { lines, subtotal, coupon } = await this.pricedCart(v, email);
    const discount = coupon?.valid ? coupon.discount : new Prisma.Decimal(0);
    const options = await this.pricing.shippingOptions(dto.region, subtotal.sub(discount), !!coupon?.valid && coupon.freeShipping);
    if (!options.length) throw new BadRequestException('We do not deliver to that region yet');
    const method = dto.shippingMethodId ? options.find((o) => o.id === dto.shippingMethodId) : options[0];
    if (!method) throw new BadRequestException({ message: 'That delivery option is not available for your region', code: 'SHIPPING_UNAVAILABLE' });
    const totals = await this.pricing.totals(subtotal, discount, method.fee);
    return {
      shippingMethodId: method.id,
      subtotal: fmt(totals.subtotal), discountTotal: fmt(totals.discountTotal), shippingTotal: fmt(totals.shippingTotal),
      taxTotal: fmt(totals.taxTotal), taxIncluded: fmt(totals.taxIncluded), grandTotal: fmt(totals.grandTotal),
      coupon: coupon && { code: coupon.coupon.code, valid: coupon.valid, reason: coupon.reason, discount: fmt(coupon.discount) },
      issues: lines.filter((l) => l.issue).map((l) => ({ sku: l.sku, name: l.name, issue: l.issue, available: l.available })),
    };
  }

  async placeOrder(v: ViewerRef, dto: PlaceOrderDto, idempotencyKey: string | undefined) {
    requireViewer(v);
    if (!idempotencyKey || !IDEMPOTENCY_RULE.test(idempotencyKey)) {
      throw new BadRequestException({ message: 'Missing Idempotency-Key header', code: 'IDEMPOTENCY_KEY_REQUIRED' });
    }

    // 1. Retried request? Return the order we already created for this key.
    const prior = await this.findByKey(idempotencyKey, v, dto.contact?.email);
    if (prior) return prior;

    // 2. Who and where.
    const account = v.userId ? await this.prisma.user.findUniqueOrThrow({ where: { id: v.userId }, select: { email: true, phone: true } }) : null;
    if (!account && !dto.contact) throw new BadRequestException({ message: 'Enter your email and phone so we can send updates', code: 'CONTACT_REQUIRED' });
    const email = dto.contact?.email ?? account!.email;
    const contactPhone = dto.contact?.phone ?? account?.phone ?? null;
    const address = await this.resolveAddress(v, dto);

    // 3. Price everything on the server. Nothing the client sends about price is trusted.
    const { cart, lines, subtotal, coupon } = await this.pricedCart(v, email);
    const blocked = lines.filter((l) => l.issue);
    if (blocked.length) {
      throw new ConflictException({
        message: 'Some items in your bag are unavailable or low in stock. Please review your bag.',
        code: 'CART_ISSUES',
        details: blocked.map((l) => ({ sku: l.sku, name: l.name, issue: l.issue, available: l.available })),
      });
    }
    if (coupon && !coupon.valid) {
      throw new ConflictException({ message: `Code ${coupon.coupon.code}: ${coupon.reason}. Remove it to continue.`, code: 'COUPON_INVALID' });
    }
    const discount = coupon?.discount ?? new Prisma.Decimal(0);
    const options = await this.pricing.shippingOptions(address.region, subtotal.sub(discount), !!coupon?.freeShipping);
    const method = options.find((o) => o.id === dto.shippingMethodId);
    if (!method) throw new BadRequestException({ message: 'That delivery option is not available for your region', code: 'SHIPPING_UNAVAILABLE' });
    const totals = await this.pricing.totals(subtotal, discount, method.fee);
    if (dto.expectedTotal && !totals.grandTotal.eq(dto.expectedTotal)) {
      throw new ConflictException({
        message: `Your total has changed to GH₵${totals.grandTotal.toFixed(2)}. Please review before placing your order.`,
        code: 'PRICE_CHANGED',
        details: { grandTotal: fmt(totals.grandTotal) },
      });
    }

    // 4. One transaction: order, stock reservation, coupon redemption, commissions, payment record, cart conversion.
    const vendorRates = await this.vendorRates(lines.map((l) => l.vendorId));
    let orderId: number;
    try {
      orderId = await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            orderNumber: orderNumber(),
            userId: v.userId,
            guestEmail: email,
            guestPhone: contactPhone,
            status: OrderStatus.PROCESSING,
            paymentStatus: PaymentStatus.PENDING,
            subtotal: totals.subtotal, discountTotal: totals.discountTotal, shippingTotal: totals.shippingTotal,
            taxTotal: totals.taxTotal, grandTotal: totals.grandTotal,
            couponId: coupon?.coupon.id, couponCode: coupon?.coupon.code,
            shippingMethodId: method.id,
            shippingAddress: { ...address } as Prisma.InputJsonObject,
            customerNote: dto.note,
            idempotencyKey,
            channel: 'web',
          },
        });

        const allocations = await this.inventory.reserve(tx, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, sku: l.sku })), { orderId: order.id, userId: v.userId });

        // Spread the order discount across lines (pro rata) so refunds and vendor payouts are exact.
        let discountLeft = totals.discountTotal;
        for (const [idx, line] of lines.entries()) {
          const parts = allocations.filter((a) => a.variantId === line.variantId);
          const lineDiscount = idx === lines.length - 1
            ? discountLeft
            : totals.subtotal.isZero() ? new Prisma.Decimal(0) : totals.discountTotal.mul(line.lineTotal).div(totals.subtotal).toDecimalPlaces(2);
          discountLeft = discountLeft.sub(lineDiscount);
          let partLeft = lineDiscount;
          for (const [pi, part] of parts.entries()) {
            const share = pi === parts.length - 1 ? partLeft : lineDiscount.mul(part.quantity).div(line.quantity).toDecimalPlaces(2);
            partLeft = partLeft.sub(share);
            const gross = line.unitPrice.mul(part.quantity);
            const item = await tx.orderItem.create({
              data: {
                orderId: order.id, productId: line.productId, variantId: line.variantId, vendorId: line.vendorId,
                warehouseId: part.warehouseId, productName: line.name, variantLabel: line.variantLabel || null,
                sku: line.sku, imageUrl: line.image, unitPrice: line.unitPrice, quantity: part.quantity,
                discountAmount: share, lineTotal: gross.sub(share),
              },
            });
            if (line.vendorId) {
              const rate = vendorRates.get(line.vendorId) ?? new Prisma.Decimal(15);
              const net = gross.sub(share);
              const commission = net.mul(rate).div(100).toDecimalPlaces(2);
              await tx.vendorCommission.create({
                data: { vendorId: line.vendorId, orderItemId: item.id, rate, grossAmount: net, commissionAmount: commission,
                  netAmount: net.sub(commission), status: CommissionStatus.PENDING },
              });
            }
          }
        }

        if (coupon) {
          const claimed = await tx.$executeRaw`
            UPDATE coupons SET used_count = used_count + 1
            WHERE id = ${coupon.coupon.id} AND (usage_limit IS NULL OR used_count < usage_limit)`;
          if (claimed !== 1) throw new ConflictException({ message: 'That code has just reached its usage limit', code: 'COUPON_INVALID' });
          await tx.couponRedemption.create({ data: { couponId: coupon.coupon.id, userId: v.userId, orderId: order.id, discountAmount: totals.discountTotal } });
        }

        await tx.payment.create({
          data: {
            orderId: order.id, provider: PaymentProvider.CASH_ON_DELIVERY, method: PaymentMethod.CASH,
            reference: `PAY-${order.orderNumber}-${randomBytes(3).toString('hex').toUpperCase()}`,
            amount: totals.grandTotal, status: PaymentTxnStatus.PENDING, payerPhone: contactPhone,
          },
        });
        await tx.orderStatusHistory.create({
          data: { orderId: order.id, toStatus: OrderStatus.PROCESSING, note: 'Order placed. Pay cash or MoMo to the rider on delivery.', changedBy: v.userId },
        });
        await tx.cart.update({ where: { id: cart.id }, data: { status: CartStatus.CONVERTED, couponId: null } });
        if (v.userId) {
          await tx.customer.updateMany({ where: { userId: v.userId }, data: { orderCount: { increment: 1 }, lastOrderAt: new Date() } });
          if (dto.saveAddress && dto.address) await this.saveAddress(tx, v.userId, dto.address);
        }
        return order.id;
      }, { timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (e) {
      // Two identical requests racing: the loser hits the unique idempotency key and gets the winner's order.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target).includes('idempotency')) {
        const winner = await this.findByKey(idempotencyKey, v, email);
        if (winner) return winner;
      }
      throw e;
    }

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
    return presentOrder(order);
  }

  private async findByKey(key: string, v: ViewerRef, email?: string | null) {
    const order = await this.prisma.order.findUnique({ where: { idempotencyKey: key }, include: orderInclude });
    if (!order) return null;
    const mine = v.userId ? order.userId === v.userId : !order.userId && !!email && order.guestEmail === email;
    if (!mine) throw new ConflictException({ message: 'This checkout session was already used. Please refresh and try again.', code: 'IDEMPOTENCY_CONFLICT' });
    return presentOrder(order);
  }

  private async resolveAddress(v: ViewerRef, dto: PlaceOrderDto): Promise<AddressInput & { countryCode: string }> {
    if (dto.addressId) {
      if (!v.userId) throw new BadRequestException('Sign in to use a saved address');
      const a = await this.prisma.address.findFirst({ where: { id: dto.addressId, userId: v.userId, deletedAt: null } });
      if (!a) throw new NotFoundException('That address was not found');
      return {
        label: a.label ?? undefined, recipientName: a.recipientName, phone: a.phone, line1: a.line1, line2: a.line2 ?? undefined,
        city: a.city, region: a.region, digitalAddress: a.digitalAddress ?? undefined, landmark: a.landmark ?? undefined, countryCode: a.countryCode,
      };
    }
    if (!dto.address) throw new BadRequestException({ message: 'Enter a delivery address', code: 'ADDRESS_REQUIRED' });
    return { ...dto.address, countryCode: 'GH' };
  }

  private async saveAddress(tx: Prisma.TransactionClient, userId: number, a: AddressInput) {
    const count = await tx.address.count({ where: { userId, deletedAt: null } });
    await tx.address.create({ data: { userId, ...a, isDefault: count === 0 } });
  }

  private async vendorRates(ids: Array<number | null>) {
    const vendorIds = [...new Set(ids.filter((x): x is number => x != null))];
    if (!vendorIds.length) return new Map<number, Prisma.Decimal>();
    const rows = await this.prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, commissionRate: true } });
    return new Map(rows.map((r) => [r.id, r.commissionRate]));
  }

  /** Guest order lookup by number + email. Responds identically whether the order or the email is wrong. */
  async lookup(dto: LookupDto) {
    const order = await this.prisma.order.findUnique({ where: { orderNumber: dto.orderNumber.toUpperCase() }, include: orderInclude });
    if (!order || order.guestEmail !== dto.email) throw new NotFoundException('We could not find an order with those details');
    return presentOrder(order);
  }
}

@ApiTags('Checkout')
@Public()
@Controller()
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Get('checkout/shipping-options')
  shippingOptions(@Viewer() v: ViewerRef, @Query() q: RegionQuery) {
    return this.checkout.shippingOptions(v, q.region);
  }

  @Post('checkout/quote')
  @HttpCode(200)
  quote(@Viewer() v: ViewerRef, @Body() dto: QuoteDto) {
    return this.checkout.quote(v, dto);
  }

  @Post('checkout/orders')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Random 16–64 char key, reused on retries of the same checkout' })
  place(@Viewer() v: ViewerRef, @Body() dto: PlaceOrderDto, @Headers('idempotency-key') key?: string) {
    return this.checkout.placeOrder(v, dto, key);
  }

  @Post('orders/lookup')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  lookup(@Body() dto: LookupDto) {
    return this.checkout.lookup(dto);
  }
}

@Module({
  imports: [CartModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
