import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RequirePermissions } from '../../common/decorators';
import { LoyaltyService } from '../loyalty/loyalty.module';
import { DateRangeQuery, resolveRange } from './admin-common';

const n = (v: unknown) => Number(v ?? 0);
const money = (v: unknown) => n(v).toFixed(2);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
/** Orders that count as sales: placed and not cancelled or still awaiting online payment. */
const SOLD = Prisma.sql`o.status NOT IN ('CANCELLED', 'PENDING_PAYMENT')`;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
  ) {}

  async overview(q: DateRangeQuery) {
    const { from, to, days } = resolveRange(q);
    const [funnel, products, departments, regions, customers, searches, zeroSearches, promotions, coupons, points, liability, settings] = await Promise.all([
      this.funnel(from, to),
      this.prisma.$queryRaw<Array<{ id: number; name: string; slug: string; views: bigint; units: bigint | null; revenue: Prisma.Decimal | null }>>`
        SELECT p.id, p.name, p.slug, v.views, s.units, s.revenue FROM (
          SELECT product_id, COUNT(*) AS views FROM product_views WHERE viewed_at >= ${from} AND viewed_at < ${to} GROUP BY product_id ORDER BY views DESC LIMIT 12
        ) v JOIN products p ON p.id = v.product_id
        LEFT JOIN (
          SELECT oi.product_id, SUM(oi.quantity) AS units, SUM(oi.line_total) AS revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
          WHERE ${SOLD} AND o.placed_at >= ${from} AND o.placed_at < ${to} GROUP BY oi.product_id
        ) s ON s.product_id = p.id ORDER BY v.views DESC`,
      this.prisma.$queryRaw<Array<{ name: string; revenue: Prisma.Decimal; units: bigint; orders: bigint }>>`
        SELECT COALESCE(parent.name, c.name) AS name, SUM(oi.line_total) AS revenue, SUM(oi.quantity) AS units, COUNT(DISTINCT o.id) AS orders
        FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
        JOIN categories c ON c.id = p.category_id LEFT JOIN categories parent ON parent.id = c.parent_id
        WHERE ${SOLD} AND o.placed_at >= ${from} AND o.placed_at < ${to}
        GROUP BY COALESCE(parent.name, c.name) ORDER BY revenue DESC`,
      this.prisma.$queryRaw<Array<{ region: string | null; revenue: Prisma.Decimal; orders: bigint }>>`
        SELECT JSON_UNQUOTE(JSON_EXTRACT(o.shipping_address, '$.region')) AS region, SUM(o.grand_total - o.refunded_total) AS revenue, COUNT(*) AS orders
        FROM orders o WHERE ${SOLD} AND o.placed_at >= ${from} AND o.placed_at < ${to}
        GROUP BY region ORDER BY revenue DESC`,
      this.prisma.$queryRaw<Array<{ kind: string; customers: bigint; orders: bigint; revenue: Prisma.Decimal }>>`
        SELECT CASE WHEN f.first_at >= ${from} THEN 'new' ELSE 'returning' END AS kind,
               COUNT(DISTINCT o.user_id) AS customers, COUNT(*) AS orders, SUM(o.grand_total - o.refunded_total) AS revenue
        FROM orders o JOIN (
          SELECT user_id, MIN(placed_at) AS first_at FROM orders o WHERE ${SOLD} AND user_id IS NOT NULL GROUP BY user_id
        ) f ON f.user_id = o.user_id
        WHERE ${SOLD} AND o.placed_at >= ${from} AND o.placed_at < ${to}
        GROUP BY kind`,
      this.prisma.searchTerm.findMany({ where: { lastSearchedAt: { gte: from } }, orderBy: { searchCount: 'desc' }, take: 10, select: { term: true, searchCount: true, resultCount: true } }),
      this.prisma.searchTerm.findMany({ where: { resultCount: 0, lastSearchedAt: { gte: from } }, orderBy: { searchCount: 'desc' }, take: 10, select: { term: true, searchCount: true, lastSearchedAt: true } }),
      this.prisma.$queryRaw<Array<{ id: number; name: string; slug: string; units: bigint; revenue: Prisma.Decimal; orders: bigint }>>`
        SELECT pr.id, pr.name, pr.slug, SUM(oi.quantity) AS units, SUM(oi.line_total) AS revenue, COUNT(DISTINCT o.id) AS orders
        FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN promotions pr ON pr.id = oi.promotion_id
        WHERE ${SOLD} AND o.placed_at >= ${from} AND o.placed_at < ${to}
        GROUP BY pr.id, pr.name, pr.slug ORDER BY revenue DESC LIMIT 10`,
      this.prisma.$queryRaw<Array<{ code: string; uses: bigint; discount: Prisma.Decimal; revenue: Prisma.Decimal }>>`
        SELECT o.coupon_code AS code, COUNT(*) AS uses, SUM(o.discount_total - o.loyalty_discount) AS discount, SUM(o.grand_total) AS revenue
        FROM orders o WHERE ${SOLD} AND o.coupon_code IS NOT NULL AND o.placed_at >= ${from} AND o.placed_at < ${to}
        GROUP BY o.coupon_code ORDER BY uses DESC LIMIT 10`,
      this.prisma.$queryRaw<Array<{ type: string; points: bigint }>>`
        SELECT type, SUM(points) AS points FROM loyalty_transactions WHERE created_at >= ${from} AND created_at < ${to} GROUP BY type`,
      this.prisma.loyaltyAccount.aggregate({ _sum: { pointsBalance: true } }),
      this.loyalty.settings(),
    ]);

    const byKind = (k: string) => customers.find((c) => c.kind === k);
    const ptsOf = (t: string) => n(points.find((p) => p.type === t)?.points);
    const outstanding = liability._sum.pointsBalance ?? 0;
    return {
      range: { from, to, days },
      funnel,
      topViewed: products.map((p) => ({ id: p.id, name: p.name, slug: p.slug, views: n(p.views), units: n(p.units), revenue: money(p.revenue), conversion: pct(n(p.units), n(p.views)) })),
      departments: departments.map((d) => ({ name: d.name, revenue: money(d.revenue), units: n(d.units), orders: n(d.orders) })),
      regions: regions.map((r) => ({ region: r.region ?? 'Unknown', revenue: money(r.revenue), orders: n(r.orders) })),
      customers: {
        new: { customers: n(byKind('new')?.customers), orders: n(byKind('new')?.orders), revenue: money(byKind('new')?.revenue) },
        returning: { customers: n(byKind('returning')?.customers), orders: n(byKind('returning')?.orders), revenue: money(byKind('returning')?.revenue) },
      },
      search: { top: searches, zeroResults: zeroSearches },
      promotions: promotions.map((p) => ({ id: p.id, name: p.name, slug: p.slug, units: n(p.units), revenue: money(p.revenue), orders: n(p.orders) })),
      coupons: coupons.map((c) => ({ code: c.code, uses: n(c.uses), discount: money(c.discount), revenue: money(c.revenue) })),
      loyalty: {
        issued: ptsOf('EARN') + ptsOf('REFERRAL_BONUS') + ptsOf('REVIEW_BONUS'),
        redeemed: -ptsOf('REDEEM'),
        outstandingPoints: outstanding,
        liability: (outstanding * settings.cediPerPoint).toFixed(2),
      },
    };
  }

  private async funnel(from: Date, to: Date) {
    const [views, carts, orders] = await Promise.all([
      this.prisma.$queryRaw<Array<{ visitors: bigint; views: bigint }>>`
        SELECT COUNT(DISTINCT COALESCE(CONCAT('u', user_id), CONCAT('s', session_id))) AS visitors, COUNT(*) AS views
        FROM product_views WHERE viewed_at >= ${from} AND viewed_at < ${to}`,
      this.prisma.$queryRaw<Array<{ carts: bigint }>>`
        SELECT COUNT(DISTINCT cart_id) AS carts FROM cart_items WHERE added_at >= ${from} AND added_at < ${to}`,
      this.prisma.$queryRaw<Array<{ placed: bigint; paid: bigint; delivered: bigint; revenue: Prisma.Decimal | null; aov: Prisma.Decimal | null }>>`
        SELECT COUNT(*) AS placed,
               SUM(o.status NOT IN ('CANCELLED', 'PENDING_PAYMENT')) AS paid,
               SUM(o.status IN ('DELIVERED', 'COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED')) AS delivered,
               SUM(CASE WHEN ${SOLD} THEN o.grand_total - o.refunded_total ELSE 0 END) AS revenue,
               AVG(CASE WHEN ${SOLD} THEN o.grand_total END) AS aov
        FROM orders o WHERE o.placed_at >= ${from} AND o.placed_at < ${to}`,
    ]);
    const visitors = n(views[0]?.visitors);
    const steps = [
      { step: 'Viewed a product', count: visitors },
      { step: 'Added to bag', count: n(carts[0]?.carts) },
      { step: 'Placed an order', count: n(orders[0]?.placed) },
      { step: 'Confirmed (paid or cash on delivery)', count: n(orders[0]?.paid) },
      { step: 'Delivered', count: n(orders[0]?.delivered) },
    ];
    return {
      productViews: n(views[0]?.views),
      // A ratio is only meaningful when a step is a subset of the one before it. Orders from shoppers we have no
      // product-view record for (older orders, imports) can make a later step larger; then we report no ratio.
      steps: steps.map((s, i) => ({ ...s, ofPrevious: i === 0 ? 100 : s.count <= steps[i - 1].count ? pct(s.count, steps[i - 1].count) : null })),
      conversionRate: n(orders[0]?.paid) <= visitors && visitors > 0 ? pct(n(orders[0]?.paid), visitors) : null,
      revenue: money(orders[0]?.revenue),
      averageOrderValue: money(orders[0]?.aov),
    };
  }
}

@ApiTags('Admin · Analytics')
@ApiBearerAuth()
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  @Get() @RequirePermissions(PERMISSIONS.ANALYTICS_VIEW)
  overview(@Query() q: DateRangeQuery) { return this.svc.overview(q); }
}

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService] })
export class AdminAnalyticsModule {}
