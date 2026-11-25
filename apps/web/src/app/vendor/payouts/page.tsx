'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { FilterSelect, KpiTile, PageHeader, Pager, Panel, QueryState, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { api } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatMoney } from '@/lib/format';
import type { PaginationMeta } from '@velora/shared';

interface Earning {
  id: number; status: string; rate: string; grossAmount: string; commissionAmount: string; netAmount: string; eligibleAt: string | null;
  settlement: { id: number; reference: string } | null; orderNumber: string; placedAt: string; product: string; variant: string | null; quantity: number;
}
interface Earnings { items: Earning[]; meta: PaginationMeta; summary: { onHold: string; payable: string; settled: string; commissionTaken: string } }
export interface Settlement {
  id: number; reference: string; status: string; periodStart: string; periodEnd: string; grossAmount: string; commissionAmount: string; netAmount: string;
  adjustments: string; paidAt: string | null; payoutReference: string | null; createdAt: string; lines: number;
}

const d = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function PayoutsInner() {
  const f = useUrlFilters();
  const query = { status: f.get('status'), page: f.get('page') || 1, pageSize: 20 };
  const earnings = useQuery({ queryKey: ['vendor-earnings', query], queryFn: () => api<Earnings>(`/vendor/earnings${qs(query)}`), placeholderData: (p) => p });
  const settlements = useQuery({ queryKey: ['vendor-settlements'], queryFn: () => api<Settlement[]>('/vendor/settlements') });
  const s = earnings.data?.summary;
  return (
    <>
      <PageHeader title="Earnings & payouts" description="Each sale earns you the price minus VÉLORA’s commission. Earnings are held until the order is delivered and its 14-day return window closes, then paid on your next statement." />
      {s && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile label="On hold" value={formatMoney(s.onHold)} hint="Awaiting delivery / return window" />
          <KpiTile label="Ready for payout" value={formatMoney(s.payable)} hint="Included in the next statement" />
          <KpiTile label="Paid to you" value={formatMoney(s.settled)} hint="All time" />
          <KpiTile label="Commission to date" value={formatMoney(s.commissionTaken)} hint="All sales so far" />
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Earnings by sale" padded={false} actions={
          <FilterSelect label="Status" value={f.get('status')} onChange={(v) => f.set('status', v)}
            options={[['', 'All'], ['PENDING', 'On hold'], ['ELIGIBLE', 'Ready'], ['SETTLED', 'Paid'], ['REVERSED', 'Reversed']]} />
        }>
          <QueryState q={earnings} empty={!earnings.data?.items.length} emptyText="No earnings yet.">
            <Table head={['Order', 'Item', 'Sale', 'Commission', 'You earn', 'Status']}>
              {earnings.data?.items.map((e) => (
                <tr key={e.id}>
                  <Td><Link href={`/vendor/orders/${e.orderNumber}`} className="font-medium hover:underline">{e.orderNumber}</Link><span className="block text-xs text-muted">{d(e.placedAt)}</span></Td>
                  <Td>{e.product}<span className="block text-xs text-muted">{e.variant} · ×{e.quantity}</span></Td>
                  <Td>{formatMoney(e.grossAmount)}</Td>
                  <Td className="text-muted">{formatMoney(e.commissionAmount)} <span className="text-xs">({e.rate}%)</span></Td>
                  <Td className="font-semibold">{formatMoney(e.netAmount)}</Td>
                  <Td>
                    <StatusPill status={e.status === 'SETTLED' ? 'PAID' : e.status} />
                    {e.settlement ? <Link href={`/vendor/payouts/${e.settlement.id}`} className="block text-xs underline">{e.settlement.reference}</Link>
                      : e.status === 'PENDING' && e.eligibleAt ? <span className="block text-xs text-muted">from {d(e.eligibleAt)}</span> : null}
                  </Td>
                </tr>
              ))}
            </Table>
            <Pager meta={earnings.data?.meta} onPage={(n) => f.set('page', String(n))} />
          </QueryState>
        </Panel>
        <Panel title="Statements" padded={false}>
          <QueryState q={settlements} empty={!settlements.data?.length} emptyText="No statements yet. VÉLORA issues statements for earnings that are ready.">
            <ul className="divide-y divide-line">
              {settlements.data?.map((st) => (
                <li key={st.id}>
                  <Link href={`/vendor/payouts/${st.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-ivory">
                    <span><span className="block font-semibold">{st.reference}</span><span className="text-xs text-muted">{st.lines} sales · {d(st.periodStart)} – {d(st.periodEnd)}</span></span>
                    <span className="text-right"><b className="block">{formatMoney(st.netAmount)}</b><StatusPill status={st.status} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </QueryState>
        </Panel>
      </div>
    </>
  );
}

export default function VendorPayoutsPage() {
  return <Suspense><PayoutsInner /></Suspense>;
}
