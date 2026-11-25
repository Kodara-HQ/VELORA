'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';
import { cx } from '@/lib/cx';
import { formatMoney } from '@/lib/format';
import type { VendorOrder } from '@/components/admin/types';


const VIEWS: Array<[string, string]> = [['', 'All'], ['to_prepare', 'To prepare'], ['shipped', 'Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']];

function OrdersInner() {
  const f = useUrlFilters();
  const query = { view: f.get('view'), q: f.get('q'), page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['vendor-orders', query], queryFn: () => apiWithMeta<VendorOrder[]>(`/vendor/orders${qs(query)}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Orders" description="Orders that include your products. VÉLORA handles payment, delivery and customer contact; prepare the pieces listed for each order." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Order views" className="flex flex-wrap gap-1.5">
          {VIEWS.map(([v, l]) => (
            <button key={v} type="button" onClick={() => f.set('view', v)} aria-pressed={f.get('view') === v}
              className={cx('rounded-full border px-3.5 py-1.5 text-sm', f.get('view') === v ? 'border-ink bg-ink text-paper' : 'border-line bg-paper hover:border-ink')}>{l}</button>
          ))}
        </nav>
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Order number" />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No orders here yet.">
          <Table head={['Order', 'Placed', 'Status', 'Your items', 'Ship to', 'Sales', 'Your earnings']}>
            {q.data?.data.map((o) => (
              <tr key={o.orderNumber} className="hover:bg-ivory">
                <Td><Link href={`/vendor/orders/${o.orderNumber}`} className="font-semibold hover:underline">{o.orderNumber}</Link></Td>
                <Td className="whitespace-nowrap text-muted">{new Date(o.placedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Td>
                <Td><StatusPill status={o.status} /></Td>
                <Td>{o.lines.reduce((s, l) => s + l.quantity, 0)} · <span className="text-muted">{o.lines.map((l) => l.name).join(', ')}</span></Td>
                <Td className="text-muted">{[o.customer.city, o.customer.region].filter(Boolean).join(', ')}</Td>
                <Td>{formatMoney(o.totals.gross)}</Td>
                <Td className="font-semibold">{formatMoney(o.totals.net)}</Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function VendorOrdersPage() {
  return <Suspense><OrdersInner /></Suspense>;
}
