'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { RankBars, RevenueBars } from '@/components/admin/charts';
import { FilterSelect, KpiTile, PageHeader, Panel, QueryState, StatusPill, Table, Td } from '@/components/admin/ui';
import { useCategories } from '@/components/site-chrome';
import { Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { daysAgo, isoDay, qs } from '@/lib/admin';
import { formatDateTime, formatMoney } from '@/lib/format';

interface Dashboard {
  range: { from: string; to: string; days: number };
  kpis: {
    revenue: { value: string; change: number }; orders: { value: number; change: number }; averageOrderValue: { value: string; change: number };
    customers: { value: number; newInRange: number }; products: { value: number };
    pending: number; shipped: number; completed: number; cancelled: number; refunds: { value: string; count: number };
  };
  series: Array<{ date: string; orders: number; revenue: string }>;
  bestSellers: Array<{ productId: number; name: string; image: string | null; units: number; revenue: string }>;
  topCategories: Array<{ categoryId: number; name: string; units: number; revenue: string }>;
  recentOrders: Array<{ orderNumber: string; status: string; paymentStatus: string; grandTotal: string; placedAt: string; customer: string }>;
  inventoryAlerts: Array<{ variantId: number; sku: string; name: string; label: string; available: number; reorderLevel: number }>;
}

const RANGES: Array<[string, string]> = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']];

export default function AdminDashboard() {
  const [days, setDays] = useState('30');
  const [categoryId, setCategoryId] = useState('');
  const [channel, setChannel] = useState('');
  const cats = useCategories();
  const q = useQuery({
    queryKey: ['admin-dashboard', days, categoryId, channel],
    queryFn: () => api<Dashboard>(`/admin/dashboard${qs({ from: daysAgo(Number(days) - 1), to: isoDay(new Date()), categoryId, channel })}`),
    placeholderData: (p) => p,
  });
  const d = q.data;

  return (
    <>
      <PageHeader title="Dashboard" description={d && `${new Date(d.range.from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – today · compared with the previous ${d.range.days} days`}
        actions={
          <>
            <FilterSelect label="Date range" value={days} onChange={setDays} options={RANGES} />
            <FilterSelect label="Department" value={categoryId} onChange={setCategoryId} options={[['', 'All departments'], ...(cats.data ?? []).map((c) => [String(c.id), c.name] as [string, string])]} />
            <FilterSelect label="Channel" value={channel} onChange={setChannel} options={[['', 'All channels'], ['web', 'Website'], ['mobile', 'Mobile app']]} />
          </>
        } />

      {!d ? (
        <QueryState q={q}><div /></QueryState>
      ) : (
        <div className={q.isFetching ? 'opacity-70 transition-opacity' : undefined}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile label="Revenue" value={formatMoney(d.kpis.revenue.value)} change={d.kpis.revenue.change} hint="vs previous period" />
            <KpiTile label="Orders" value={d.kpis.orders.value.toLocaleString()} change={d.kpis.orders.change} hint={`${d.kpis.cancelled} cancelled`} />
            <KpiTile label="Average order value" value={formatMoney(d.kpis.averageOrderValue.value)} change={d.kpis.averageOrderValue.change} />
            <KpiTile label="Customers" value={d.kpis.customers.value.toLocaleString()} hint={`+${d.kpis.customers.newInRange} new in this period`} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              ['To fulfil', d.kpis.pending, '/admin/orders?status=PROCESSING'],
              ['In transit', d.kpis.shipped, '/admin/orders?status=SHIPPED'],
              ['Completed', d.kpis.completed, '/admin/orders?status=DELIVERED'],
              ['Refunds', `${formatMoney(d.kpis.refunds.value)} (${d.kpis.refunds.count})`, '/admin/orders?paymentStatus=REFUNDED'],
              ['Live products', d.kpis.products.value, '/admin/products?status=ACTIVE'],
            ].map(([label, value, href]) => (
              <Link key={label as string} href={href as string} className="rounded-md border border-line bg-paper px-4 py-3 hover:border-ink">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-1 text-lg font-bold">{value}</p>
              </Link>
            ))}
          </div>

          <Panel title="Revenue by day" className="mt-6">
            <RevenueBars data={d.series} />
          </Panel>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel title="Best sellers" actions={<Link href="/admin/products?sort=sold" className="text-xs font-semibold underline">All products</Link>}>
              {d.bestSellers.length ? (
                <RankBars rows={d.bestSellers.map((b) => ({ label: b.name, value: b.units, display: `${b.units} sold`, sub: formatMoney(b.revenue) }))} />
              ) : <p className="text-sm text-muted">No sales in this period.</p>}
            </Panel>
            <Panel title="Top departments">
              {d.topCategories.length ? (
                <RankBars rows={d.topCategories.map((c) => ({ label: c.name, value: Number(c.revenue), display: formatMoney(c.revenue), sub: `${c.units} units` }))} />
              ) : <p className="text-sm text-muted">No sales in this period.</p>}
            </Panel>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <Panel title="Recent orders" padded={false} actions={<Link href="/admin/orders" className="text-xs font-semibold underline">All orders</Link>}>
              <Table head={['Order', 'Customer', 'Placed', 'Status', 'Total']}>
                {d.recentOrders.map((o) => (
                  <tr key={o.orderNumber} className="hover:bg-ivory">
                    <Td><Link href={`/admin/orders/${o.orderNumber}`} className="font-semibold hover:underline">{o.orderNumber}</Link></Td>
                    <Td className="max-w-40 truncate">{o.customer}</Td>
                    <Td className="whitespace-nowrap text-muted">{formatDateTime(o.placedAt)}</Td>
                    <Td><StatusPill status={o.status} /></Td>
                    <Td className="text-right font-semibold">{formatMoney(o.grandTotal)}</Td>
                  </tr>
                ))}
              </Table>
            </Panel>
            <Panel title={`Inventory alerts (${d.inventoryAlerts.length})`} padded={false} actions={<Link href="/admin/inventory?stock=low" className="text-xs font-semibold underline">Stock levels</Link>}>
              {d.inventoryAlerts.length ? (
                <ul className="divide-y divide-line">
                  {d.inventoryAlerts.map((a) => (
                    <li key={a.variantId} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="text-xs text-muted">{a.sku} · {a.label}</span>
                      </span>
                      <span className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-semibold ${a.available <= 0 ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'}`}>
                        {a.available <= 0 ? 'Out of stock' : `${a.available} left`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="px-5 py-8 text-center text-sm text-muted">Every variant is above its reorder level.</p>}
            </Panel>
          </div>
        </div>
      )}
      {q.isPending && <Skeleton className="mt-4 h-64" />}
    </>
  );
}
