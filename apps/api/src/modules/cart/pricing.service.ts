import { Injectable } from '@nestjs/common';
import { Coupon, DiscountType, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { visibleWhere } from '../catalog/product-card';
import { activePromotions, promoUnitPrice, type ActivePromo } from '../promotions/promo-pricing';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
/** Max units of one variant per order (anti-hoarding; also bounds flash-sale abuse). */
export const MAX_QTY_PER_LINE = 10;

export const cartItemInclude = {
  variant: {
    include: {
      product: {
        select: {
          id: true, slug: true, name: true, basePrice: true, compareAtPrice: true, currency: true, vendorId: true,
          status: true, deletedAt: true, publishedAt: true,
          vendor: { select: { status: true, deletedAt: true, commissionRate: true } },
          brand: { select: { name: true } },
          images: { orderBy: { sortOrder: 'asc' }, select: { url: true, color: true } },
        },
      },
      inventory: { select: { quantityOnHand: true, quantityReserved: true, warehouse: { select: { isActive: true } } } },
    },
  },
} satisfies Prisma.CartItemInclude;

export type CartItemRow = Prisma.CartItemGetPayload<{ include: typeof cartItemInclude }>;

export interface PricedLine {
  itemId: number;
  variantId: number;
  productId: number;
  vendorId: number | null;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  sku: string;
  color: string | null;
  size: string | null;
  variantLabel: string;
  unitPrice: Prisma.Decimal;
  compareAtPrice: Prisma.Decimal | null;
  quantity: number;
  available: number;
  lineTotal: Prisma.Decimal;
  /** The live promotion that set unitPrice, if any. */
  promotion: { id: number; name: string; slug: string; endsAt: Date; stockLeft: number | null } | null;
  /** Why this line can't be checked out as-is; empty when fine. */
  issue: 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | null;
}

export interface CouponResult {
  coupon: Coupon;
  valid: boolean;
  reason: string | null;
  discount: Prisma.Decimal;
  freeShipping: boolean;
}

export interface Totals {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  shippingTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  /** Tax already contained in tax-inclusive prices (shown on receipts, not added). */
  taxIncluded: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Prices a set of cart items with the promotions live right now. */
  async priceItems(items: CartItemRow[]): Promise<PricedLine[]> {
    const promos = await activePromotions(this.prisma, items.map((i) => i.variant.product.id));
    return items.map((i) => this.priceLine(i, promos));
  }

  priceLine(item: CartItemRow, promos: Map<number, ActivePromo> = new Map()): PricedLine {
    const v = item.variant;
    const p = v.product;
    const visible =
      p.status === 'ACTIVE' && !p.deletedAt && !!p.publishedAt && p.publishedAt <= new Date() &&
      v.isActive && !v.deletedAt && (!p.vendorId || (p.vendor?.status === 'ACTIVE' && !p.vendor.deletedAt));
    const available = v.inventory
      .filter((i) => i.warehouse.isActive)
      .reduce((s, i) => s + Math.max(0, i.quantityOnHand - i.quantityReserved), 0);
    const listPrice = v.price ?? p.basePrice;
    const promo = promos.get(p.id);
    const promoPrice = promoUnitPrice(listPrice, promo);
    const unitPrice = promoPrice ?? listPrice;
    const compare = promoPrice ? listPrice : v.compareAtPrice ?? p.compareAtPrice;
    const stockLeft = promo?.stockLimit != null ? Math.max(0, promo.stockLimit - promo.soldCount) : null;
    const image = p.images.find((i) => i.color && i.color === v.color)?.url ?? p.images[0]?.url ?? null;
    return {
      itemId: item.id, variantId: v.id, productId: p.id, vendorId: p.vendorId,
      slug: p.slug, name: p.name, brand: p.brand?.name ?? null, image, sku: v.sku,
      color: v.color, size: v.size,
      variantLabel: [v.color, v.size].filter(Boolean).join(' / '),
      unitPrice, compareAtPrice: compare && compare.gt(unitPrice) ? compare : null,
      quantity: item.quantity, available,
      lineTotal: money(unitPrice.mul(item.quantity)),
      promotion: promo && promoPrice ? { id: promo.promotionId, name: promo.name, slug: promo.slug, endsAt: promo.endsAt, stockLeft } : null,
      issue: !visible ? 'UNAVAILABLE' : available === 0 ? 'OUT_OF_STOCK' : available < item.quantity ? 'INSUFFICIENT_STOCK' : null,
    };
  }

  subtotal(lines: PricedLine[]) {
    return lines.filter((l) => l.issue !== 'UNAVAILABLE').reduce((s, l) => s.add(l.lineTotal), ZERO);
  }

  /** Validates a coupon for this basket and shopper. Never throws: returns `valid` + a reason. */
  async evaluateCoupon(coupon: Coupon, ctx: { subtotal: Prisma.Decimal; userId: number | null; email: string | null }): Promise<CouponResult> {
    const fail = (reason: string): CouponResult => ({ coupon, valid: false, reason, discount: ZERO, freeShipping: false });
    const now = new Date();
    if (!coupon.isActive) return fail('This code is no longer active');
    if (coupon.startsAt && coupon.startsAt > now) return fail('This code is not active yet');
    if (coupon.endsAt && coupon.endsAt < now) return fail('This code has expired');
    if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return fail('This code has reached its usage limit');
    if (coupon.minOrderAmount && ctx.subtotal.lt(coupon.minOrderAmount)) {
      return fail(`Spend GH₵${coupon.minOrderAmount.toFixed(2)} or more to use this code`);
    }

    const ownOrders: Prisma.OrderWhereInput | null = ctx.userId
      ? { userId: ctx.userId }
      : ctx.email ? { guestEmail: ctx.email } : null;
    const notCancelled = { status: { notIn: [OrderStatus.CANCELLED] } };

    if (coupon.firstOrderOnly && ownOrders) {
      const previous = await this.prisma.order.count({ where: { ...ownOrders, ...notCancelled } });
      if (previous > 0) return fail('This code is for first orders only');
    }
    if (coupon.usageLimitPerUser != null && ownOrders) {
      const used = await this.prisma.couponRedemption.count({ where: { couponId: coupon.id, order: { ...ownOrders, ...notCancelled } } });
      if (used >= coupon.usageLimitPerUser) return fail('You have already used this code');
    }

    let discount = ZERO;
    if (coupon.type === DiscountType.PERCENTAGE) {
      discount = money(ctx.subtotal.mul(coupon.value).div(100));
      if (coupon.maxDiscountAmount && discount.gt(coupon.maxDiscountAmount)) discount = coupon.maxDiscountAmount;
    } else if (coupon.type === DiscountType.FIXED_AMOUNT) {
      discount = Prisma.Decimal.min(coupon.value, ctx.subtotal);
    }
    return { coupon, valid: true, reason: null, discount: money(discount), freeShipping: coupon.type === DiscountType.FREE_SHIPPING };
  }

  async findCoupon(code: string) {
    return this.prisma.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
  }

  /** Delivery methods for a Ghana region, with the fee this basket would pay. */
  async shippingOptions(region: string, merchandiseTotal: Prisma.Decimal, freeShipping = false) {
    const zones = await this.prisma.shippingZone.findMany({
      where: { isActive: true },
      include: { methods: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
    const zone = zones.find((z) => Array.isArray(z.regions) && (z.regions as string[]).includes(region));
    if (!zone) return [];
    return zone.methods.map((m) => {
      const qualifiesFree = freeShipping || (m.freeOverAmount != null && merchandiseTotal.gte(m.freeOverAmount));
      return {
        id: m.id, code: m.code, name: m.name, carrier: m.carrier, zone: zone.name,
        baseFee: m.fee, fee: qualifiesFree ? ZERO : m.fee,
        freeOver: m.freeOverAmount, minDays: m.minDays, maxDays: m.maxDays,
      };
    });
  }

  /** Tax lines come from system settings (`tax.rates`), so finance can configure them without a deploy. */
  async tax(base: Prisma.Decimal) {
    const settings = await this.prisma.systemSetting.findMany({ where: { group: 'tax' } });
    const get = (k: string) => settings.find((s) => s.key === k)?.value;
    const inclusive = get('pricesIncludeTax') !== false;
    const rates = (Array.isArray(get('rates')) ? get('rates') : []) as Array<{ name: string; rate: number }>;
    const rate = rates.reduce((s, r) => s + (Number(r.rate) || 0), 0) / 100;
    if (!rate) return { added: ZERO, included: ZERO };
    return inclusive
      ? { added: ZERO, included: money(base.sub(base.div(1 + rate))) }
      : { added: money(base.mul(rate)), included: ZERO };
  }

  async totals(subtotal: Prisma.Decimal, discount: Prisma.Decimal, shipping: Prisma.Decimal): Promise<Totals> {
    const merchandise = Prisma.Decimal.max(ZERO, subtotal.sub(discount));
    const tax = await this.tax(merchandise);
    return {
      subtotal: money(subtotal),
      discountTotal: money(discount),
      shippingTotal: money(shipping),
      taxTotal: tax.added,
      taxIncluded: tax.included,
      grandTotal: money(merchandise.add(shipping).add(tax.added)),
    };
  }

  isVisibleWhere = visibleWhere;
}

export const fmt = (d: Prisma.Decimal | null | undefined) => (d == null ? null : d.toFixed(2));
