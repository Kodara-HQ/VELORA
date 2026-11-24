import { Controller, Get, Injectable, Module, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { PERMISSIONS } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { RequirePermissions } from '../../common/decorators';
import { CatalogModule, } from '../catalog/catalog.module';
import { CatalogService } from '../catalog/catalog.service';
import { DateRangeQuery, resolveRange, sendCsv } from './admin-common';

class ReportQuery extends DateRangeQuery {
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'] }) @IsOptional() @IsIn(['day', 'week', 'month'])
  groupBy: 'day' | 'week' | 'month' = 'day';

  @ApiPropertyOptional({ enum: ['json', 'csv'] }) @IsOptional() @IsIn(['json', 'csv'])
  format: 'json' | 'csv' = 'json';
}

const num = (v: unknown) => Number(v ?? 0);
const money = (v: unknown) => Number(v ?? 0).toFixed(2);
const pct = (cur: number, prev: number) => (prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 1000) / 10);

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  /** SQL fragments shared by every sales query: date range, channel, and item scope (category / product). */
  private async scope(q: DateRangeQuery, from: Date, to: Date) {
    const catIds = q.categoryId ? await this.subtree(q.categoryId) : null;
    const itemFilter = catIds || q.productId
      ? Prisma.sql`AND oi.product_id IN (SELECT p.id FROM products p WHERE 1=1
          ${catIds ? Prisma.sql`AND p.category_id IN (${Prisma.join(catIds)})` : Prisma.empty}
          ${q.productId ? Prisma.sql`AND p.id = ${q.productId}` : Prisma.empty})`
      : Prisma.empty;
    const orderFilter = Prisma.sql`o.placed_at >= ${from} AND o.placed_at < ${to} ${q.channel ? Prisma.sql`AND o.channel = ${q.channel}` : Prisma.empty}`;
    return { itemFilter, orderFilter, scoped: !!(catIds || q.productId) };
  }

  private async subtree(categoryId: number) {
    const { byId } = await this.catalog.categoryTree();
    const ids: number[] = [];
    const walk = (id: number) => { ids.push(id); byId.get(id)?.children.forEach((c) => walk(c.id)); };
    walk(categoryId);
    return ids;
  }

  private async kpis(q: DateRangeQuery, from: Date, to: Date) {
    const { itemFilter, orderFilter, scoped } = await this.scope(q, from, to);
    // When scoped to a category/product, revenue is item revenue; otherwise full order totals.
    const [row] = scoped
      ? await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT COUNT(DISTINCT o.id) AS orders,
                 COUNT(DISTINCT CASE WHEN o.status <> 'CANCELLED' THEN o.id END) AS live_orders,
                 COALESCE(SUM(CASE WHEN o.status <> 'CANCELLED' THEN oi.line_total END), 0) AS revenue,
                 COUNT(DISTINCT CASE WHEN o.status IN ('PENDING_PAYMENT','PAID','PROCESSING') THEN o.id END) AS pending,
                 COUNT(DISTINCT CASE WHEN o.status IN ('SHIPPED','PARTIALLY_SHIPPED') THEN o.id END) AS shipped,
                 COUNT(DISTINCT CASE WHEN o.status IN ('DELIVERED','COMPLETED') THEN o.id END) AS completed,
                 COUNT(DISTINCT CASE WHEN o.status = 'CANCELLED' THEN o.id END) AS cancelled
          FROM orders o JOIN order_items oi ON oi.order_id = o.id
          WHERE ${orderFilter} ${itemFilter}`
      : await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT COUNT(*) AS orders,
                 SUM(o.status <> 'CANCELLED') AS live_orders,
                 COALESCE(SUM(CASE WHEN o.status <> 'CANCELLED' THEN o.grand_total END), 0) AS revenue,
                 SUM(o.status IN ('PENDING_PAYMENT','PAID','PROCESSING')) AS pending,
                 SUM(o.status IN ('SHIPPED','PARTIALLY_SHIPPED')) AS shipped,
                 SUM(o.status IN ('DELIVERED','COMPLETED')) AS completed,
                 SUM(o.status = 'CANCELLED') AS cancelled
          FROM orders o WHERE ${orderFilter}`;
    return {
      orders: num(row.orders), liveOrders: num(row.live_orders), revenue: num(row.revenue),
      pending: num(row.pending), shipped: num(row.shipped), completed: num(row.completed), cancelled: num(row.cancelled),
    };
  }

  async dashboard(q: DateRangeQuery) {
    const { from, to, days } = resolveRange(q);
    const prevFrom = new Date(from.getTime() - days * 86_400_000);
    const { itemFilter, orderFilter } = await this.scope(q, from, to);

    const [cur, prev, refunds, customers, newCustomers, products, series, best, cats, recent, lowStock] = await Promise.all([
      this.kpis(q, from, to),
      this.kpis(q, prevFrom, from),
      this.prisma.refund.aggregate({ where: { status: 'COMPLETED', processedAt: { gte: from, lt: to } }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.user.count({ where: { deletedAt: null, roles: { some: { role: { code: 'customer' } } } } }),
      this.prisma.user.count({ where: { deletedAt: null, createdAt: { gte: from, lt: to }, roles: { some: { role: { code: 'customer' } } } } }),
      this.prisma.product.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.$queryRaw<Array<{ d: Date; orders: bigint; revenue: Prisma.Decimal }>>`
        SELECT DATE(o.placed_at) AS d, COUNT(DISTINCT o.id) AS orders,
               COALESCE(SUM(${itemFilter === Prisma.empty ? Prisma.sql`o.grand_total` : Prisma.sql`oi.line_total`}), 0) AS revenue
        FROM orders o ${itemFilter === Prisma.empty ? Prisma.empty : Prisma.sql`JOIN order_items oi ON oi.order_id = o.id`}
        WHERE ${orderFilter} AND o.status <> 'CANCELLED' ${itemFilter}
        GROUP BY DATE(o.placed_at) ORDER BY d`,
      this.prisma.$queryRaw<Array<{ product_id: number; name: string; image: string | null; units: bigint; revenue: Prisma.Decimal }>>`
        SELECT oi.product_id, MAX(oi.product_name) AS name, MAX(oi.image_url) AS image, SUM(oi.quantity) AS units, SUM(oi.line_total) AS revenue
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE ${orderFilter} AND o.status <> 'CANCELLED' AND oi.product_id IS NOT NULL ${itemFilter}
        GROUP BY oi.product_id ORDER BY units DESC, revenue DESC LIMIT 8`,
      this.prisma.$queryRaw<Array<{ category_id: number; units: bigint; revenue: Prisma.Decimal }>>`
        SELECT COALESCE(c.parent_id, c.id) AS category_id, SUM(oi.quantity) AS units, SUM(oi.line_total) AS revenue
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
        WHERE ${orderFilter} AND o.status <> 'CANCELLED' ${itemFilter}
        GROUP BY COALESCE(c.parent_id, c.id) ORDER BY revenue DESC LIMIT 6`,
      this.prisma.order.findMany({
        orderBy: { placedAt: 'desc' }, take: 8,
        select: { orderNumber: true, status: true, paymentStatus: true, grandTotal: true, placedAt: true, guestEmail: true,
          shippingAddress: true, payments: { take: 1, orderBy: { createdAt: 'desc' }, select: { method: true, status: true } } },
      }),
      this.prisma.$queryRaw<Array<{ variant_id: number; sku: string; name: string; label: string; available: bigint; reorder_level: number }>>`
        SELECT v.id AS variant_id, v.sku, p.name, CONCAT_WS(' / ', v.color, v.size) AS label,
               SUM(i.quantity_on_hand - i.quantity_reserved) AS available, MAX(i.reorder_level) AS reorder_level
        FROM product_variants v JOIN products p ON p.id = v.product_id JOIN inventory i ON i.variant_id = v.id
        WHERE v.is_active = 1 AND v.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
        GROUP BY v.id, v.sku, p.name, v.color, v.size
        HAVING available <= MAX(i.reorder_level)
        ORDER BY available ASC, p.name LIMIT 12`,
    ]);

    const { byId } = await this.catalog.categoryTree();
    // Fill gaps so charts show zero days rather than skipping them.
    const byDay = new Map(series.map((s) => [new Date(s.d).toISOString().slice(0, 10), s]));
    const filled = Array.from({ length: days }, (_, i) => {
      const day = new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      const s = byDay.get(day);
      return { date: day, orders: num(s?.orders), revenue: money(s?.revenue) };
    });
    const aov = cur.liveOrders ? cur.revenue / cur.liveOrders : 0;
    const prevAov = prev.liveOrders ? prev.revenue / prev.liveOrders : 0;

    return {
      range: { from: from.toISOString(), to: to.toISOString(), days },
      kpis: {
        revenue: { value: money(cur.revenue), change: pct(cur.revenue, prev.revenue) },
        orders: { value: cur.orders, change: pct(cur.orders, prev.orders) },
        averageOrderValue: { value: money(aov), change: pct(aov, prevAov) },
        customers: { value: customers, newInRange: newCustomers },
        products: { value: products },
        pending: cur.pending, shipped: cur.shipped, completed: cur.completed, cancelled: cur.cancelled,
        refunds: { value: money(refunds._sum.amount), count: refunds._count._all },
      },
      series: filled,
      bestSellers: best.map((b) => ({ productId: Number(b.product_id), name: b.name, image: b.image, units: num(b.units), revenue: money(b.revenue) })),
      topCategories: cats.map((c) => ({ categoryId: Number(c.category_id), name: byId.get(Number(c.category_id))?.name ?? 'Other', units: num(c.units), revenue: money(c.revenue) })),
      recentOrders: recent.map((o) => ({
        orderNumber: o.orderNumber, status: o.status, paymentStatus: o.paymentStatus, grandTotal: o.grandTotal.toFixed(2), placedAt: o.placedAt,
        customer: (o.shippingAddress as { recipientName?: string } | null)?.recipientName ?? o.guestEmail, payment: o.payments[0] ?? null,
      })),
      inventoryAlerts: lowStock.map((l) => ({ variantId: Number(l.variant_id), sku: l.sku, name: l.name, label: l.label, available: num(l.available), reorderLevel: num(l.reorder_level) })),
    };
  }

  /** Bell-icon counts for the admin top bar. */
  async notifications() {
    const [pending, lowStock, pendingVendors, pendingProducts] = await Promise.all([
      this.prisma.order.count({ where: { status: { in: ['PENDING_PAYMENT', 'PAID', 'PROCESSING'] } } }),
      this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*) AS n FROM (
          SELECT v.id FROM product_variants v JOIN inventory i ON i.variant_id = v.id JOIN products p ON p.id = v.product_id
          WHERE v.is_active = 1 AND v.deleted_at IS NULL AND p.status = 'ACTIVE'
          GROUP BY v.id HAVING SUM(i.quantity_on_hand - i.quantity_reserved) <= MAX(i.reorder_level)) t`,
      this.prisma.vendorApplication.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
      this.prisma.product.count({ where: { status: 'PENDING_REVIEW', deletedAt: null } }),
    ]);
    return { ordersToFulfil: pending, lowStockVariants: num(lowStock[0]?.n), vendorApplications: pendingVendors, productsToReview: pendingProducts };
  }

  async salesReport(q: ReportQuery) {
    const { from, to } = resolveRange(q);
    const { itemFilter, orderFilter } = await this.scope(q, from, to);
    const bucket = q.groupBy === 'month' ? Prisma.sql`DATE_FORMAT(o.placed_at, '%Y-%m')`
      : q.groupBy === 'week' ? Prisma.sql`DATE_FORMAT(DATE_SUB(DATE(o.placed_at), INTERVAL WEEKDAY(o.placed_at) DAY), '%Y-%m-%d')`
      : Prisma.sql`DATE_FORMAT(o.placed_at, '%Y-%m-%d')`;
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${bucket} AS period,
             COUNT(DISTINCT o.id) AS orders,
             SUM(oi.quantity) AS units,
             SUM(oi.unit_price * oi.quantity) AS gross,
             SUM(oi.discount_amount) AS discounts,
             SUM(oi.line_total) AS net_merchandise
      FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE ${orderFilter} AND o.status <> 'CANCELLED' ${itemFilter}
      GROUP BY period ORDER BY period`;
    const shipping = await this.prisma.$queryRaw<Array<{ period: string; shipping: Prisma.Decimal }>>`
      SELECT ${bucket} AS period, SUM(o.shipping_total) AS shipping FROM orders o
      WHERE ${orderFilter} AND o.status <> 'CANCELLED' GROUP BY period`;
    const shipBy = new Map(shipping.map((s) => [s.period, s.shipping]));
    const data = rows.map((r) => ({
      period: String(r.period), orders: num(r.orders), units: num(r.units), gross: money(r.gross), discounts: money(r.discounts),
      netMerchandise: money(r.net_merchandise), shipping: money(shipBy.get(String(r.period))),
    }));
    const totals = data.reduce((t, r) => ({
      orders: t.orders + r.orders, units: t.units + r.units, gross: t.gross + Number(r.gross), discounts: t.discounts + Number(r.discounts),
      netMerchandise: t.netMerchandise + Number(r.netMerchandise), shipping: t.shipping + Number(r.shipping),
    }), { orders: 0, units: 0, gross: 0, discounts: 0, netMerchandise: 0, shipping: 0 });
    return { range: { from, to }, groupBy: q.groupBy, rows: data, totals: { ...totals, gross: totals.gross.toFixed(2), discounts: totals.discounts.toFixed(2), netMerchandise: totals.netMerchandise.toFixed(2), shipping: totals.shipping.toFixed(2) } };
  }
}

@ApiTags('Admin · Dashboard & reports')
@ApiBearerAuth()
@Controller('admin')
export class AdminDashboardController {
  constructor(private readonly svc: AdminDashboardService) {}

  @Get('dashboard')
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  dashboard(@Query() q: DateRangeQuery) {
    return this.svc.dashboard(q);
  }

  @Get('notifications')
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  notifications() {
    return this.svc.notifications();
  }

  @Get('reports/sales')
  @RequirePermissions(PERMISSIONS.ANALYTICS_VIEW)
  async sales(@Query() q: ReportQuery, @Res({ passthrough: true }) res: Response) {
    const report = await this.svc.salesReport(q);
    if (q.format !== 'csv') return report;
    return sendCsv(res, `velora-sales-${q.groupBy}.csv`, ['Period', 'Orders', 'Units', 'Gross (GHS)', 'Discounts (GHS)', 'Net merchandise (GHS)', 'Delivery (GHS)'],
      report.rows.map((r) => [r.period, r.orders, r.units, r.gross, r.discounts, r.netMerchandise, r.shipping]));
  }
}

@Module({ imports: [CatalogModule], controllers: [AdminDashboardController], providers: [AdminDashboardService] })
export class AdminDashboardModule {}
