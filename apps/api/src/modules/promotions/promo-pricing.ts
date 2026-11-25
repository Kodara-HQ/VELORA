import { Prisma, PromotionType } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { toCard, type CardRow, type ProductCard } from '../catalog/product-card';

type Db = PrismaService | Prisma.TransactionClient;

/** Promotion types that change a product's price. (Basket-level offers use coupons.) */
export const PRICE_PROMOTIONS: PromotionType[] = [PromotionType.FLASH_SALE, PromotionType.PERCENTAGE_OFF, PromotionType.FIXED_AMOUNT_OFF];

export interface ActivePromo {
  promotionId: number;
  name: string;
  slug: string;
  type: PromotionType;
  headline: string | null;
  endsAt: Date;
  value: Prisma.Decimal | null;
  salePrice: Prisma.Decimal | null;
  stockLimit: number | null;
  soldCount: number;
}

export interface PromoBadge { name: string; slug: string; type: PromotionType; endsAt: string; stockLeft: number | null; percentOff: number }

export const activePromotionWhere = (now = new Date()): Prisma.PromotionWhereInput => ({
  isActive: true, startsAt: { lte: now }, endsAt: { gt: now }, type: { in: PRICE_PROMOTIONS },
});

/**
 * The promotion currently pricing each product (highest priority wins; sold-out flash allocations are skipped).
 * Always read fresh from the database: prices must change the second a sale starts or ends.
 */
export async function activePromotions(db: Db, productIds: number[], now = new Date()): Promise<Map<number, ActivePromo>> {
  const out = new Map<number, ActivePromo>();
  const ids = [...new Set(productIds)];
  if (!ids.length) return out;
  const rows = await db.promotionProduct.findMany({
    where: { productId: { in: ids }, promotion: activePromotionWhere(now) },
    include: { promotion: true },
    orderBy: [{ promotion: { priority: 'desc' } }, { promotion: { endsAt: 'asc' } }],
  });
  for (const r of rows) {
    if (out.has(r.productId)) continue;
    if (r.stockLimit != null && r.soldCount >= r.stockLimit) continue;
    out.set(r.productId, {
      promotionId: r.promotionId, name: r.promotion.name, slug: r.promotion.slug, type: r.promotion.type, headline: r.promotion.headline,
      endsAt: r.promotion.endsAt, value: r.promotion.value, salePrice: r.salePrice, stockLimit: r.stockLimit, soldCount: r.soldCount,
    });
  }
  return out;
}

const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** The promotional price for a unit price, or null when the promotion doesn't make it cheaper. */
export function promoUnitPrice(unit: Prisma.Decimal, promo: ActivePromo | undefined | null): Prisma.Decimal | null {
  if (!promo) return null;
  let price: Prisma.Decimal | null = null;
  if (promo.salePrice) price = promo.salePrice;
  else if (promo.value && (promo.type === PromotionType.PERCENTAGE_OFF || promo.type === PromotionType.FLASH_SALE)) price = money(unit.mul(new Prisma.Decimal(100).sub(promo.value)).div(100));
  else if (promo.value && promo.type === PromotionType.FIXED_AMOUNT_OFF) price = money(unit.sub(promo.value));
  if (!price || price.lte(0) || price.gte(unit)) return null;
  return price;
}

export function promoBadge(promo: ActivePromo, unit: Prisma.Decimal, price: Prisma.Decimal): PromoBadge {
  return {
    name: promo.name, slug: promo.slug, type: promo.type, endsAt: promo.endsAt.toISOString(),
    stockLeft: promo.stockLimit != null ? Math.max(0, promo.stockLimit - promo.soldCount) : null,
    percentOff: Math.round((1 - Number(price) / Number(unit)) * 100),
  };
}

export type PricedCard = ProductCard & { promotion: PromoBadge | null };

/** Product cards with live promotion prices applied. Use this instead of rows.map(toCard) anywhere cards are shown. */
export async function toCards(db: Db, rows: CardRow[]): Promise<PricedCard[]> {
  const promos = await activePromotions(db, rows.map((r) => r.id));
  return rows.map((r) => {
    const card = toCard(r);
    const promo = promos.get(r.id);
    const price = promoUnitPrice(r.basePrice, promo);
    if (!promo || !price) return { ...card, promotion: null };
    // During a promotion the strike-through is today's list price, so the shown saving matches the badge.
    return { ...card, price: price.toFixed(2), compareAtPrice: r.basePrice.toFixed(2), promotion: promoBadge(promo, r.basePrice, price) };
  });
}
