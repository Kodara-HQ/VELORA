'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { FilterSelect, PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { qs } from '@/lib/admin';
import { cx } from '@/lib/cx';
import { formatMoney } from '@/lib/format';

interface Row { id: number; name: string; email: string; phone: string | null; status: string; createdAt: string; orderCount: number; lifetimeValue: string; averageOrderValue: string; lastOrderAt: string | null; tier: string; points: number; segment: string; marketingOptIn: boolean }
interface Page { items: Row[]; meta: { page: number; pageSize: number; total: number; totalPages: number }; segments: Record<string, number> }

const SEGMENT_LABEL: Record<string, { label: string; hint: string }> = {
  VIP: { label: 'VIP', hint: 'Lifetime spend GH₵2,000+' },
  LOYAL: { label: 'Loyal', hint: '3+ orders, active in 90 days' },
  NEW: { label: 'New', hint: 'Joined in the last 30 days' },
  AT_RISK: { label: 'At risk', hint: 'No order for 90+ days' },
  PROSPECT: { label: 'Prospect', hint: 'Registered, never ordered' },
  REGULAR: { label: 'Regular', hint: '1–2 orders, recently active' },
};
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Inner() {
  const f = useUrlFilters();
  const query = { q: f.get('q'), segment: f.get('segment'), status: f.get('status'), sort: f.get('sort') || 'recent', page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['admin-customers', query], queryFn: () => api<Page>(`/admin/customers${qs(query)}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Customers" description="Segments are recalculated live from orders and lifetime value." />
      {q.data && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Segments">
          <button type="button" onClick={() => f.set('segment', '')} className={cx('rounded-full border px-3 py-1.5 text-sm', !f.get('segment') ? 'border-ink bg-ink text-paper' : 'border-line bg-paper')}>All</button>
          {Object.entries(q.data.segments).map(([s, n]) => (
            <button key={s} type="button" title={SEGMENT_LABEL[s]?.hint} onClick={() => f.set('segment', s)} aria-pressed={f.get('segment') === s}
              className={cx('rounded-full border px-3 py-1.5 text-sm', f.get('segment') === s ? 'border-ink bg-ink text-paper' : 'border-line bg-paper hover:border-ink')}>
              {SEGMENT_LABEL[s]?.label ?? s} <span className="opacity-60">{n}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Search name, email or phone" />
        <FilterSelect label="Status" value={f.get('status')} onChange={(v) => f.set('status', v)} options={[['', 'Any status'], ['ACTIVE', 'Active'], ['SUSPENDED', 'Suspended']]} />
        <FilterSelect label="Sort" value={f.get('sort') || 'recent'} onChange={(v) => f.set('sort', v)} options={[['recent', 'Newest'], ['ltv', 'Lifetime value'], ['orders', 'Most orders'], ['name', 'Name']]} />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.items.length} emptyText="No customers match.">
          <Table head={['Customer', 'Segment', 'Orders', 'Lifetime value', 'Avg order', 'Last order', 'Rewards', 'Status']}>
            {q.data?.items.map((c) => (
              <tr key={c.id} className="hover:bg-ivory">
                <Td><Link href={`/admin/customers/${c.id}`} className="font-semibold hover:underline">{c.name}</Link><span className="block text-xs text-muted">{c.email}</span></Td>
                <Td><Badge tone={c.segment === 'VIP' ? 'ink' : c.segment === 'AT_RISK' ? 'rose' : 'neutral'}>{SEGMENT_LABEL[c.segment]?.label}</Badge></Td>
                <Td>{c.orderCount}</Td><Td className="font-semibold">{formatMoney(c.lifetimeValue)}</Td><Td>{formatMoney(c.averageOrderValue)}</Td>
                <Td className="text-muted">{fmtDate(c.lastOrderAt)}</Td>
                <Td className="text-xs">{c.tier.toLowerCase()} · {c.points.toLocaleString()} pts</Td>
                <Td><StatusPill status={c.status} /></Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function CustomersPage() {
  return <Suspense><Inner /></Suspense>;
}
