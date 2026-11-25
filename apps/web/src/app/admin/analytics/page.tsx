'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { RankBars } from '@/components/admin/charts';
import { FilterSelect, Forbidden, KpiTile, PageHeader, Panel, QueryState, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { api } from '@/lib/api';
import { daysAgo, qs } from '@/lib/admin';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Analytics {
  funnel: { productViews: number; conversionRate: number | null; revenue: string; averageOrderValue: string; steps: Array<{ step: string; count: number; ofPrevious: number | null }> };
  topViewed: Array<{ id: number; name: string; slug: string; views: number; units: number; revenue: string; conversion: number }>;
  departments: Array<{ name: string; revenue: string; units: number; orders: number }>;
  regions: Array<{ region: string; revenue: string; orders: number }>;
  customers: Record<'new' | 'returning', { customers: number; orders: number; revenue: string }>;
  search: { top: Array<{ term: string; searchCount: number; resultCount: number }>; zeroResults: Array<{ term: string; searchCount: number; lastSearchedAt: string }> };
  promotions: Array<{ id: number; name: string; units: number; revenue: string; orders: number }>;
  coupons: Array<{ code: string; uses: number; discount: string; revenue: string }>;
  loyalty: { issued: number; redeemed: number; outstandingPoints: number; liability: string };
}

const RANGES: Array<[string, string]> = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']];

function AnalyticsInner() {
  const f = useUrlFilters();
  const can = useCan('analytics.view');
  const days = f.get('days') || '30';
  const q = useQuery({ queryKey: ['admin-analytics', days], queryFn: () => api<Analytics>(`/admin/analytics${qs({ from: daysAgo(Number(days) - 1) })}`), enabled: can, placeholderData: (p) => p });
  if (!can) return <Forbidden />;
  const a = q.data;
  const maxStep = Math.max(...(a?.funnel.steps.map((s) => s.count) ?? [1]), 1);

  return (
    <>
      <PageHeader title="Analytics" description="How shoppers find, consider and buy. Revenue excludes cancelled and unpaid orders, net of refunds."
        actions={<FilterSelect label="Range" value={days} onChange={(v) => f.set('days', v)} options={RANGES} />} />
      <QueryState q={q} rows={6}>
        {a && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiTile label="Revenue" value={formatMoney(a.funnel.revenue)} hint={`AOV ${formatMoney(a.funnel.averageOrderValue)}`} />
              <KpiTile label="Conversion" value={a.funnel.conversionRate == null ? '—' : `${a.funnel.conversionRate}%`} hint={a.funnel.conversionRate == null ? 'Not enough product-view data yet' : 'Confirmed orders ÷ product viewers'} />
              <KpiTile label="Product views" value={a.funnel.productViews.toLocaleString()} hint={`${a.funnel.steps[0].count.toLocaleString()} shoppers`} />
              <KpiTile label="Points liability" value={formatMoney(a.loyalty.liability)} hint={`${a.loyalty.outstandingPoints.toLocaleString()} points unredeemed`} />
            </div>

            <Panel title="Shopping funnel">
              <ol className="space-y-3">
                {a.funnel.steps.map((s, i) => (
                  <li key={s.step} className="grid grid-cols-[minmax(0,180px)_1fr_auto] items-center gap-3 text-sm">
                    <span className="truncate">{s.step}</span>
                    <span className="h-7 overflow-hidden rounded-sm bg-sand"><span className="block h-full rounded-sm bg-ink" style={{ width: `${(s.count / maxStep) * 100}%` }} /></span>
                    <span className="w-28 text-right tabular-nums"><b>{s.count.toLocaleString()}</b>{i > 0 && s.ofPrevious != null && <span className="text-xs text-muted"> · {s.ofPrevious}%</span>}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted">Percentages compare each step with the one before it. They’re left out when a step is larger than the one before, which happens when orders come from shoppers without recorded product views (e.g. older or imported orders).</p>
            </Panel>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel title="Sales by department">
                {!a.departments.length ? <p className="text-sm text-muted">No sales in this period.</p>
                  : <RankBars rows={a.departments.map((d) => ({ label: d.name, value: Number(d.revenue), display: formatMoney(d.revenue), sub: `${d.units} units · ${d.orders} orders` }))} />}
              </Panel>
              <Panel title="Sales by region">
                {!a.regions.length ? <p className="text-sm text-muted">No sales in this period.</p>
                  : <RankBars rows={a.regions.map((r) => ({ label: r.region, value: Number(r.revenue), display: formatMoney(r.revenue), sub: `${r.orders} orders` }))} />}
              </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel title="Most viewed products" padded={false}>
                <Table head={['Product', 'Views', 'Units sold', 'View → sale']}>
                  {a.topViewed.map((p) => (
                    <tr key={p.id}>
                      <Td><Link href={`/admin/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link></Td>
                      <Td>{p.views}</Td><Td>{p.units}</Td>
                      <Td className={p.conversion < 2 && p.views >= 20 ? 'font-semibold text-rose-deep' : undefined}>{p.conversion}%</Td>
                    </tr>
                  ))}
                </Table>
              </Panel>
              <Panel title="New vs returning customers">
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  {(['new', 'returning'] as const).map((k) => (
                    <div key={k} className="rounded-sm border border-line p-4">
                      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{k === 'new' ? 'New' : 'Returning'}</dt>
                      <dd className="mt-2 font-display text-2xl font-extrabold">{formatMoney(a.customers[k].revenue)}</dd>
                      <dd className="text-xs text-muted">{a.customers[k].customers} customers · {a.customers[k].orders} orders</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-muted">Registered customers only. “New” means their first order fell in this period.</p>
              </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <Panel title="Top searches" padded={false}>
                <Table head={['Search', 'Times', 'Results']}>
                  {a.search.top.map((s) => <tr key={s.term}><Td><Link href={`/search?q=${encodeURIComponent(s.term)}`} target="_blank" className="hover:underline">{s.term}</Link></Td><Td>{s.searchCount}</Td><Td>{s.resultCount}</Td></tr>)}
                </Table>
              </Panel>
              <Panel title="Searches with no results" padded={false}>
                {!a.search.zeroResults.length ? <p className="px-5 py-8 text-center text-sm text-muted">Every search found something.</p> : (
                  <Table head={['Search', 'Times', 'Last searched']}>
                    {a.search.zeroResults.map((s) => <tr key={s.term}><Td className="font-medium">{s.term}</Td><Td>{s.searchCount}</Td><Td className="text-muted">{new Date(s.lastSearchedAt).toLocaleDateString('en-GB')}</Td></tr>)}
                  </Table>
                )}
                <p className="border-t border-line px-5 py-3 text-xs text-muted">Gaps in the range, or words to add to search synonyms.</p>
              </Panel>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <Panel title="Promotions" padded={false}>
                {!a.promotions.length ? <p className="px-5 py-8 text-center text-sm text-muted">No promotional sales.</p> : (
                  <Table head={['Promotion', 'Units', 'Revenue']}>
                    {a.promotions.map((p) => <tr key={p.id}><Td><Link href={`/admin/promotions/${p.id}`} className="hover:underline">{p.name}</Link></Td><Td>{p.units}</Td><Td>{formatMoney(p.revenue)}</Td></tr>)}
                  </Table>
                )}
              </Panel>
              <Panel title="Coupons" padded={false}>
                {!a.coupons.length ? <p className="px-5 py-8 text-center text-sm text-muted">No coupon orders.</p> : (
                  <Table head={['Code', 'Uses', 'Discount']}>
                    {a.coupons.map((c) => <tr key={c.code}><Td className="font-mono text-xs">{c.code}</Td><Td>{c.uses}</Td><Td>{formatMoney(c.discount)}</Td></tr>)}
                  </Table>
                )}
              </Panel>
              <Panel title="Loyalty">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-muted">Points issued</dt><dd>{a.loyalty.issued.toLocaleString()}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Points redeemed</dt><dd>{a.loyalty.redeemed.toLocaleString()}</dd></div>
                  <div className="flex justify-between border-t border-line pt-2"><dt className="text-muted">Outstanding (all time)</dt><dd>{a.loyalty.outstandingPoints.toLocaleString()}</dd></div>
                  <div className="flex justify-between font-semibold"><dt>Liability</dt><dd>{formatMoney(a.loyalty.liability)}</dd></div>
                </dl>
              </Panel>
            </div>
          </div>
        )}
      </QueryState>
    </>
  );
}

export default function AnalyticsPage() {
  return <Suspense><AnalyticsInner /></Suspense>;
}
