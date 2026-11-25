'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Badge, Button, ButtonLink, EmptyState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { errorMessage } from '@/lib/shop';
import { RETURN_REASONS, RETURN_STATUS_LABEL, type ReturnRequest } from '@/lib/types';

const STEPS = ['REQUESTED', 'APPROVED', 'ITEMS_RECEIVED', 'DONE'];

export default function ReturnsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-returns'], queryFn: () => api<ReturnRequest[]>('/me/returns') });
  const withdraw = useMutation({
    mutationFn: (n: string) => api(`/me/returns/${n}/withdraw`, { method: 'POST', body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-returns'] }),
  });

  if (q.isPending) return <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-40" />)}</div>;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  if (!q.data.length) {
    return <EmptyState title="No returns" body="You can return or exchange delivered items within 14 days from the order page."
      action={<ButtonLink href="/account/orders" variant="secondary">Go to my orders</ButtonLink>} />;
  }
  return (
    <div className="space-y-4">
      {withdraw.isError && <Alert tone="danger">{errorMessage(withdraw.error)}</Alert>}
      {q.data.map((r) => {
        const done = ['REFUNDED', 'EXCHANGED', 'CLOSED', 'REJECTED'].includes(r.status);
        const step = done ? 3 : STEPS.indexOf(r.status);
        return (
          <article key={r.returnNumber} className="rounded-sm border border-line bg-paper p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted">{r.type === 'EXCHANGE' ? 'Exchange' : 'Return'} <span className="font-mono">{r.returnNumber}</span> · order <Link href={`/account/orders/${r.order.orderNumber}`} className="underline">{r.order.orderNumber}</Link> · {formatDateTime(r.createdAt)}</p>
                <p className="mt-1 font-display text-lg font-bold">{RETURN_STATUS_LABEL[r.status]}</p>
              </div>
              <Badge tone={r.status === 'REJECTED' ? 'danger' : done ? 'success' : 'neutral'}>{RETURN_REASONS[r.reason]}</Badge>
            </div>
            {r.status !== 'REJECTED' && r.status !== 'CLOSED' && (
              <ol className="mt-4 grid grid-cols-4 gap-2 text-xs" aria-label="Return progress">
                {['Requested', 'Approved', 'Received', r.type === 'EXCHANGE' ? 'Exchange sent' : 'Refunded'].map((label, i) => (
                  <li key={label}><span className={`block h-1.5 rounded-full ${i <= step ? 'bg-ink' : 'bg-sand'}`} /><span className={`mt-1.5 block ${i <= step ? 'font-semibold' : 'text-muted'}`}>{label}</span></li>
                ))}
              </ol>
            )}
            {r.adminNote && <p className="mt-4 rounded-sm bg-sand px-3 py-2 text-sm">{r.adminNote}</p>}
            <ul className="mt-4 space-y-2 text-sm">
              {r.items.map((i) => (
                <li key={i.id} className="flex items-center gap-3">
                  <span className="h-12 w-9 shrink-0 overflow-hidden rounded-sm bg-sand">{i.image && <img src={i.image} alt="" className="h-full w-full object-cover" />}</span>
                  <span className="flex-1">{i.quantity} × {i.name} <span className="text-muted">({i.variantLabel})</span>{i.exchangeFor && <span className="block text-xs">→ swap for {i.exchangeFor.label}</span>}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>{r.refundAmount && <>Refund: <b>{formatMoney(r.refundAmount)}</b>{r.refunds[0]?.status === 'COMPLETED' && ' · paid'}</>}</span>
              {r.status === 'REQUESTED' && <Button size="sm" variant="ghost" loading={withdraw.isPending && withdraw.variables === r.returnNumber} onClick={() => withdraw.mutate(r.returnNumber)}>Withdraw request</Button>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
