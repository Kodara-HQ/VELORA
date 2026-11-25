'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { FilterSelect, PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { Badge } from '@/components/ui';
import { apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatDateTime, formatMoney } from '@/lib/format';
import { RETURN_REASONS, type ReturnRequest } from '@/lib/types';

function Inner() {
  const f = useUrlFilters();
  const query = { q: f.get('q'), status: f.get('status'), type: f.get('type'), page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['admin-returns', query], queryFn: () => apiWithMeta<ReturnRequest[]>(`/admin/returns${qs(query)}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Returns & exchanges" description="Approve requests, receive items back, and send refunds to Finance or exchanges to fulfilment." />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Return no., order no. or email" />
        <FilterSelect label="Status" value={f.get('status')} onChange={(v) => f.set('status', v)}
          options={[['', 'Any status'], ['REQUESTED', 'Requested'], ['APPROVED', 'Approved (awaiting items)'], ['ITEMS_RECEIVED', 'Received'], ['REFUNDED', 'Refunded'], ['EXCHANGED', 'Exchanged'], ['REJECTED', 'Rejected'], ['CLOSED', 'Closed']]} />
        <FilterSelect label="Type" value={f.get('type')} onChange={(v) => f.set('type', v)} options={[['', 'Returns & exchanges'], ['RETURN', 'Returns'], ['EXCHANGE', 'Exchanges']]} />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No returns match.">
          <Table head={['Return', 'Order', 'Customer', 'Items', 'Reason', 'Status', 'Refund', 'Requested']}>
            {q.data?.data.map((r) => (
              <tr key={r.returnNumber} className="hover:bg-ivory">
                <Td><Link href={`/admin/returns/${r.returnNumber}`} className="font-mono text-xs font-semibold hover:underline">{r.returnNumber}</Link>
                  {r.type === 'EXCHANGE' && <Badge tone="outline" className="ml-2">Exchange</Badge>}</Td>
                <Td><Link href={`/admin/orders/${r.order.orderNumber}`} className="hover:underline">{r.order.orderNumber}</Link></Td>
                <Td className="max-w-40 truncate">{r.customer}</Td>
                <Td>{r.items.reduce((s, i) => s + i.quantity, 0)}</Td>
                <Td>{RETURN_REASONS[r.reason]}</Td>
                <Td><StatusPill status={r.status} /></Td>
                <Td>{r.refundAmount ? formatMoney(r.refundAmount) : '—'}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(r.createdAt)}</Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function AdminReturnsPage() {
  return <Suspense><Inner /></Suspense>;
}
