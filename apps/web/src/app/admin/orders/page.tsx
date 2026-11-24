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

interface Row {
  orderNumber: string; status: string; paymentStatus: string; grandTotal: string; placedAt: string; channel: string; customer: string; email: string | null;
  isGuest: boolean; destination: string; items: number; paymentMethod: string | null; shippingMethod: string | null;
}

function OrdersInner() {
  const f = useUrlFilters();
  const query = { q: f.get('q'), status: f.get('status'), paymentStatus: f.get('paymentStatus'), view: f.get('view'), channel: f.get('channel'), from: f.get('from'), to: f.get('to'), page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['admin-orders', query], queryFn: () => apiWithMeta<Row[]>(`/admin/orders${qs(query)}`), placeholderData: (p) => p });

  return (
    <>
      <PageHeader title="Orders" description="Search by order number, customer, email, phone or SKU." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Search orders" />
        <FilterSelect label="View" value={f.get('view')} onChange={(v) => f.set('view', v)} options={[['', 'All orders'], ['open', 'Needs action']]} />
        <FilterSelect label="Status" value={f.get('status')} onChange={(v) => f.set('status', v)}
          options={[['', 'Any status'], ['PROCESSING', 'Being prepared'], ['SHIPPED', 'Shipped'], ['DELIVERED', 'Delivered'], ['CANCELLED', 'Cancelled'], ['PENDING_PAYMENT', 'Awaiting payment'], ['REFUNDED', 'Refunded']]} />
        <FilterSelect label="Payment" value={f.get('paymentStatus')} onChange={(v) => f.set('paymentStatus', v)}
          options={[['', 'Any payment'], ['PENDING', 'Pending'], ['PAID', 'Paid'], ['REFUNDED', 'Refunded']]} />
        <FilterSelect label="Channel" value={f.get('channel')} onChange={(v) => f.set('channel', v)} options={[['', 'All channels'], ['web', 'Website'], ['mobile', 'Mobile app']]} />
        <input type="date" aria-label="From date" value={f.get('from')} onChange={(e) => f.set('from', e.target.value)} className="h-10 rounded-sm border border-line bg-paper px-2 text-sm" />
        <input type="date" aria-label="To date" value={f.get('to')} onChange={(e) => f.set('to', e.target.value)} className="h-10 rounded-sm border border-line bg-paper px-2 text-sm" />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No orders match these filters.">
          <Table head={['Order', 'Placed', 'Customer', 'Ship to', 'Items', 'Status', 'Payment', 'Total']}>
            {q.data?.data.map((o) => (
              <tr key={o.orderNumber} className="hover:bg-ivory">
                <Td><Link href={`/admin/orders/${o.orderNumber}`} className="font-semibold hover:underline">{o.orderNumber}</Link>
                  {o.channel === 'mobile' && <span className="ml-1.5 text-[10px] uppercase text-muted">app</span>}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(o.placedAt)}</Td>
                <Td><span className="block max-w-44 truncate">{o.customer}</span>{o.isGuest && <Badge tone="outline">Guest</Badge>}</Td>
                <Td className="text-muted">{o.destination}</Td>
                <Td>{o.items}</Td>
                <Td><StatusPill status={o.status} /></Td>
                <Td><StatusPill status={o.paymentStatus} /><span className="ml-1 text-xs text-muted">{o.paymentMethod === 'CASH' ? 'COD' : o.paymentMethod}</span></Td>
                <Td className="text-right font-semibold">{formatMoney(o.grandTotal)}</Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function OrdersPage() {
  return <Suspense><OrdersInner /></Suspense>;
}
