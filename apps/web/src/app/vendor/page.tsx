'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { RevenueBars } from '@/components/admin/charts';
import { KpiTile, PageHeader, Panel, QueryState, StatusPill } from '@/components/admin/ui';
import { ButtonLink } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { VendorStats } from '@/components/admin/types';

interface Dashboard {
  vendor: { businessName: string; slug: string; commissionRate: string; payoutMethod: string | null };
  last30Days: VendorStats;
  series: Array<{ date: string; revenue: string; orders: number }>;
  recentSales: Array<{ id: number; productName: string; variantLabel: string | null; quantity: number; lineTotal: string; createdAt: string; order: { orderNumber: string; status: string } }>;
  lowStock: Array<{ variantId: number; sku: string; name: string; available: number }>;
}

export default function VendorDashboard() {
  const q = useQuery({ queryKey: ['vendor-dashboard'], queryFn: () => api<Dashboard>('/vendor/dashboard') });
  const d = q.data;
  const s = d?.last30Days;
  return (
    <>
      <PageHeader title={d ? d.vendor.businessName : 'Dashboard'}
        description={d && <>Last 30 days · {d.vendor.commissionRate}% commission · <Link href={`/v/${d.vendor.slug}`} className="underline" target="_blank">View your shop ↗</Link></>}
        actions={<ButtonLink href="/vendor/products/new">Add product</ButtonLink>} />
      <QueryState q={q}>
        {d && s && (
          <div className="space-y-6">
            {!d.vendor.payoutMethod && (
              <div className="rounded-md border border-rose-deep/40 bg-rose/30 p-4 text-sm">
                <b>Add your payout details</b> so we can pay your earnings. <Link href="/vendor/profile" className="font-semibold underline">Set up payouts</Link>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiTile label="Sales" value={formatMoney(s.grossSales)} hint={`${s.orders} orders · ${s.units} units`} />
              <KpiTile label="Earnings on hold" value={formatMoney(s.earnings.onHold)} hint="Released after the return window" />
              <KpiTile label="Ready for payout" value={formatMoney(s.earnings.payable)} hint={<Link href="/vendor/payouts" className="underline">Earnings & payouts</Link>} />
              <KpiTile label="Rating" value={s.reviewCount ? `★ ${s.rating.toFixed(1)}` : '—'} hint={`${s.reviewCount} reviews · ${s.returnRate}% returned`} />
            </div>
            <Panel title="Daily sales">
              <RevenueBars data={d.series} unit="unit" />
            </Panel>
            <div className="grid gap-6 xl:grid-cols-2">
              <Panel title="Recent sales" padded={false} actions={<Link href="/vendor/orders" className="text-xs font-semibold underline">All orders</Link>}>
                {!d.recentSales.length ? <p className="px-5 py-10 text-center text-sm text-muted">No sales yet. Once your products are live, orders show up here.</p> : (
                  <ul className="divide-y divide-line">
                    {d.recentSales.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                        <span className="min-w-0">
                          <Link href={`/vendor/orders/${r.order.orderNumber}`} className="block truncate font-medium hover:underline">{r.productName}</Link>
                          <span className="text-xs text-muted">{r.order.orderNumber} · {r.variantLabel} · ×{r.quantity}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-3"><StatusPill status={r.order.status} /><b>{formatMoney(r.lineTotal)}</b></span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <div className="space-y-6">
                <Panel title="Products">
                  <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                    {([['Live', s.products.active, 'ACTIVE'], ['In review', s.products.pendingReview, 'PENDING_REVIEW'], ['Drafts', s.products.draft, 'DRAFT'], ['Rejected', s.products.rejected, 'REJECTED']] as const).map(([l, n, st]) => (
                      <Link key={l} href={`/vendor/products?status=${st}`} className="rounded-sm border border-line p-3 hover:border-ink">
                        <dt className="text-xs text-muted">{l}</dt><dd className="font-display text-2xl font-extrabold">{n}</dd>
                      </Link>
                    ))}
                  </dl>
                </Panel>
                <Panel title="Low stock" padded={false} actions={<Link href="/vendor/inventory" className="text-xs font-semibold underline">Inventory</Link>}>
                  {!d.lowStock.length ? <p className="px-5 py-8 text-center text-sm text-muted">Every live variant has more than 3 available.</p> : (
                    <ul className="divide-y divide-line">
                      {d.lowStock.map((l) => (
                        <li key={l.variantId} className="flex justify-between gap-3 px-5 py-2.5 text-sm">
                          <span className="min-w-0 truncate">{l.name} <span className="font-mono text-xs text-muted">{l.sku}</span></span>
                          <b className={l.available <= 0 ? 'text-danger' : ''}>{l.available} left</b>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
            </div>
          </div>
        )}
      </QueryState>
    </>
  );
}
