'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { FilterSelect, humanize, KpiTile, PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { Badge } from '@/components/ui';
import { api } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatDateTime, formatMoney } from '@/lib/format';

interface Ledger {
  items: Array<{ id: number; reference: string; providerReference: string | null; provider: string; method: string; amount: string; currency: string; status: string;
    failureReason: string | null; cardLast4: string | null; cardBrand: string | null; payerPhone: string | null; verifiedAt: string | null; createdAt: string; order: { orderNumber: string; status: string } }>;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  settledByProvider: Array<{ provider: string; count: number; amount: string }>;
}
interface WebhookEvent { id: number; provider: string; eventId: string; eventType: string; processedAt: string | null; error: string | null; createdAt: string }

const PROVIDER: Record<string, string> = { PAYSTACK: 'Paystack', HUBTEL: 'Hubtel', CASH_ON_DELIVERY: 'Pay on delivery', SIMULATOR: 'Simulator (dev)' };

function Inner() {
  const f = useUrlFilters();
  const query = { q: f.get('q'), status: f.get('status'), provider: f.get('provider'), page: f.get('page') || 1, pageSize: 50 };
  const q = useQuery({ queryKey: ['admin-payments', query], queryFn: () => api<Ledger>(`/admin/payments${qs(query)}`), placeholderData: (p) => p });
  const events = useQuery({ queryKey: ['admin-webhooks'], queryFn: () => api<WebhookEvent[]>('/admin/payments/webhook-events') });
  return (
    <>
      <PageHeader title="Payments" description="Every payment attempt. Only provider-confirmed attempts (webhook or server-side verification) are marked successful." />
      {q.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {q.data.settledByProvider.map((s) => <KpiTile key={s.provider} label={`${PROVIDER[s.provider] ?? s.provider} · collected`} value={formatMoney(s.amount)} hint={`${s.count} successful payments`} />)}
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Reference or order number" />
        <FilterSelect label="Status" value={f.get('status')} onChange={(v) => f.set('status', v)}
          options={[['', 'Any status'], ['SUCCESS', 'Successful'], ['PENDING', 'Pending'], ['FAILED', 'Failed'], ['ABANDONED', 'Abandoned']]} />
        <FilterSelect label="Provider" value={f.get('provider')} onChange={(v) => f.set('provider', v)} options={[['', 'All providers'], ...Object.entries(PROVIDER)]} />
      </div>
      <Panel padded={false} className="mb-6">
        <QueryState q={q} empty={!q.data?.items.length} emptyText="No payments match.">
          <Table head={['Reference', 'Order', 'Provider', 'Method', 'Amount', 'Status', 'Created', 'Verified']}>
            {q.data?.items.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono text-xs">{p.reference}{p.providerReference && <span className="block text-muted">{p.providerReference}</span>}</Td>
                <Td><Link href={`/admin/orders/${p.order.orderNumber}`} className="hover:underline">{p.order.orderNumber}</Link></Td>
                <Td>{PROVIDER[p.provider] ?? p.provider}</Td>
                <Td className="text-xs">{humanize(p.method)}{p.cardLast4 && ` ••${p.cardLast4}`}{p.payerPhone && <span className="block text-muted">{p.payerPhone}</span>}</Td>
                <Td className="font-semibold">{formatMoney(p.amount, p.currency)}</Td>
                <Td><StatusPill status={p.status} />{p.failureReason && <span className="block max-w-48 text-[11px] text-muted">{p.failureReason}</span>}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(p.createdAt)}</Td>
                <Td className="whitespace-nowrap text-muted">{p.verifiedAt ? formatDateTime(p.verifiedAt) : '—'}</Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
      <Panel title="Recent provider webhooks" padded={false}>
        <QueryState q={events} empty={!events.data?.length} emptyText="No webhooks received yet. Configure the webhook URL in your Paystack dashboard.">
          <Table head={['Received', 'Provider', 'Event', 'ID', 'Result']}>
            {events.data?.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(e.createdAt)}</Td>
                <Td>{PROVIDER[e.provider] ?? e.provider}</Td>
                <Td className="font-mono text-xs">{e.eventType}</Td>
                <Td className="font-mono text-xs">{e.eventId}</Td>
                <Td>{e.error ? <Badge tone="danger">{e.error.slice(0, 60)}</Badge> : e.processedAt ? <Badge tone="success">Processed</Badge> : <Badge>Received</Badge>}</Td>
              </tr>
            ))}
          </Table>
        </QueryState>
      </Panel>
    </>
  );
}

export default function PaymentsPage() {
  return <Suspense><Inner /></Suspense>;
}
