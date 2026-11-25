import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

export interface VendorStats {
  orders: number;
  units: number;
  grossSales: string;
  returnedUnits: number;
  returnRate: number;
  rating: number;
  reviewCount: number;
  products: { active: number; pendingReview: number; draft: number; rejected: number; archived: number };
  earnings: { onHold: string; payable: string; settled: string; commissionTaken: string };
}

const money = (v: unknown) => Number(v ?? 0).toFixed(2);

/** Sales, product and earnings figures for one or more vendors. Cancelled and unpaid orders are excluded. */
export async function vendorStats(prisma: PrismaService, vendorIds: number[], since: Date): Promise<Map<number, VendorStats>> {
  const out = new Map<number, VendorStats>();
  if (!vendorIds.length) return out;
  const [sales, products, ratings, earnings] = await Promise.all([
    prisma.$queryRaw<Array<{ vendor_id: number; orders: bigint; units: bigint; gross: Prisma.Decimal; returned: bigint }>>`
      SELECT oi.vendor_id, COUNT(DISTINCT oi.order_id) AS orders, SUM(oi.quantity) AS units, SUM(oi.line_total) AS gross, SUM(oi.quantity_returned) AS returned
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.vendor_id IN (${Prisma.join(vendorIds)}) AND o.status NOT IN ('CANCELLED', 'PENDING_PAYMENT') AND o.placed_at >= ${since}
      GROUP BY oi.vendor_id`,
    prisma.product.groupBy({ by: ['vendorId', 'status'], where: { vendorId: { in: vendorIds }, deletedAt: null }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ vendor_id: number; rating: Prisma.Decimal | null; reviews: bigint }>>`
      SELECT vendor_id, SUM(avg_rating * review_count) / NULLIF(SUM(review_count), 0) AS rating, SUM(review_count) AS reviews
      FROM products WHERE vendor_id IN (${Prisma.join(vendorIds)}) AND deleted_at IS NULL GROUP BY vendor_id`,
    prisma.$queryRaw<Array<{ vendor_id: number; on_hold: Prisma.Decimal; payable: Prisma.Decimal; settled: Prisma.Decimal; commission: Prisma.Decimal }>>`
      SELECT vendor_id,
        SUM(CASE WHEN status = 'PENDING' OR (status = 'ELIGIBLE' AND (eligible_at IS NULL OR eligible_at > NOW())) THEN net_amount ELSE 0 END) AS on_hold,
        SUM(CASE WHEN status = 'ELIGIBLE' AND eligible_at <= NOW() AND settlement_id IS NULL THEN net_amount ELSE 0 END) AS payable,
        SUM(CASE WHEN status = 'SETTLED' THEN net_amount ELSE 0 END) AS settled,
        SUM(CASE WHEN status <> 'REVERSED' THEN commission_amount ELSE 0 END) AS commission
      FROM vendor_commissions WHERE vendor_id IN (${Prisma.join(vendorIds)}) GROUP BY vendor_id`,
  ]);
  for (const id of vendorIds) {
    const s = sales.find((x) => Number(x.vendor_id) === id);
    const r = ratings.find((x) => Number(x.vendor_id) === id);
    const e = earnings.find((x) => Number(x.vendor_id) === id);
    const count = (st: string) => products.find((p) => p.vendorId === id && p.status === st)?._count._all ?? 0;
    const units = Number(s?.units ?? 0);
    const returned = Number(s?.returned ?? 0);
    out.set(id, {
      orders: Number(s?.orders ?? 0), units, grossSales: money(s?.gross), returnedUnits: returned,
      returnRate: units ? Math.round((returned / units) * 1000) / 10 : 0,
      rating: Math.round(Number(r?.rating ?? 0) * 10) / 10, reviewCount: Number(r?.reviews ?? 0),
      products: { active: count('ACTIVE'), pendingReview: count('PENDING_REVIEW'), draft: count('DRAFT'), rejected: count('REJECTED'), archived: count('ARCHIVED') },
      earnings: { onHold: money(e?.on_hold), payable: money(e?.payable), settled: money(e?.settled), commissionTaken: money(e?.commission) },
    });
  }
  return out;
}
