'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageHeader, Panel, QueryState, StatusPill, TextArea } from '@/components/admin/ui';
import { Dialog } from '@/components/dialog';
import { Alert, Badge, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';
import { RETURN_REASONS, type ReturnRequest } from '@/lib/types';

export default function AdminReturnPage() {
  const { number } = useParams<{ number: string }>();
  const qc = useQueryClient();
  const canManage = useCan('returns.manage');
  const [modal, setModal] = useState<'approve' | 'reject' | 'receive' | null>(null);
  const [text, setText] = useState('');
  const [conditions, setConditions] = useState<Record<number, 'RESELLABLE' | 'DAMAGED'>>({});
  const [resolution, setResolution] = useState<'EXCHANGE' | 'REFUND'>('EXCHANGE');
  const q = useQuery({ queryKey: ['admin-return', number], queryFn: () => api<ReturnRequest>(`/admin/returns/${number}`) });
  const act = useMutation({
    mutationFn: (a: { path: string; body: unknown }) => api<ReturnRequest>(`/admin/returns/${number}/${a.path}`, { method: 'POST', body: a.body }),
    onSuccess: (r) => {
      qc.setQueryData(['admin-return', number], r);
      void qc.invalidateQueries({ queryKey: ['admin-returns'] });
      setModal(null);
      setText('');
    },
  });
  const r = q.data;
  const open = (m: 'approve' | 'reject' | 'receive') => {
    act.reset();
    setText('');
    if (m === 'receive' && r) setConditions(Object.fromEntries(r.items.map((i) => [i.id, 'RESELLABLE'])));
    setModal(m);
  };

  return (
    <>
      <PageHeader title={`${r?.type === 'EXCHANGE' ? 'Exchange' : 'Return'} ${number}`} back={{ href: '/admin/returns', label: 'Returns' }}
        description={r && <span className="flex flex-wrap items-center gap-2"><StatusPill status={r.status} /> {RETURN_REASONS[r.reason]} · order <Link href={`/admin/orders/${r.order.orderNumber}`} className="underline">{r.order.orderNumber}</Link> · {formatDateTime(r.createdAt)}</span>}
        actions={r && canManage && <>
          {r.status === 'REQUESTED' && <Button onClick={() => open('approve')}>Approve</Button>}
          {r.status === 'APPROVED' && <Button onClick={() => open('receive')}>Receive items</Button>}
          {(r.status === 'REQUESTED' || r.status === 'APPROVED') && <Button variant="danger" onClick={() => open('reject')}>Reject</Button>}
        </>} />
      <QueryState q={q}>
        {r && (
          <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
            <Panel title="Items">
              <ul className="divide-y divide-line">
                {r.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-4 py-3 text-sm">
                    <span className="h-14 w-11 shrink-0 overflow-hidden rounded-sm bg-sand">{i.image && <img src={i.image} alt="" className="h-full w-full object-cover" />}</span>
                    <span className="flex-1">
                      <b>{i.quantity} × {i.name}</b> <span className="text-muted">{i.variantLabel}</span>
                      <span className="block font-mono text-xs text-muted">{i.sku} · paid {formatMoney(i.unitPaid)} each</span>
                      {i.exchangeFor && <span className="block text-xs">Swap for <b>{i.exchangeFor.label}</b> <span className="font-mono">({i.exchangeFor.sku})</span></span>}
                    </span>
                    {i.condition && <Badge tone={i.condition === 'DAMAGED' ? 'danger' : 'success'}>{i.condition === 'DAMAGED' ? 'Damaged, not restocked' : 'Restocked'}</Badge>}
                  </li>
                ))}
              </ul>
            </Panel>
            <div className="space-y-6">
              <Panel title="Customer’s note"><p className="text-sm">{r.customerNote || <span className="text-muted">None</span>}</p></Panel>
              {r.adminNote && <Panel title="Note to customer"><p className="text-sm">{r.adminNote}</p></Panel>}
              {(r.refundAmount || r.refunds.length > 0) && (
                <Panel title="Refund">
                  <p className="text-sm">Amount due <b>{formatMoney(r.refundAmount ?? '0')}</b></p>
                  {r.refunds.map((f) => <p key={f.id} className="mt-1 text-sm"><StatusPill status={f.status} /> {f.providerReference && <span className="font-mono text-xs">{f.providerReference}</span>}</p>)}
                  <Link href="/admin/refunds" className="mt-2 inline-block text-xs font-semibold underline">Refunds queue</Link>
                </Panel>
              )}
            </div>
          </div>
        )}
      </QueryState>

      {modal && r && (
        <Dialog open onClose={() => setModal(null)} label={modal} className="max-w-lg">
          <div className="space-y-4 p-6">
            <h2 className="text-xl font-extrabold">{modal === 'approve' ? 'Approve return' : modal === 'reject' ? 'Reject return' : 'Receive returned items'}</h2>
            {act.isError && <Alert tone="danger">{errorMessage(act.error)}</Alert>}
            {modal === 'receive' && (
              <>
                <p className="text-sm text-muted">Check each item. Resellable items go back into stock; damaged ones are written off.</p>
                {r.items.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>{i.quantity} × {i.name} <span className="text-muted">({i.variantLabel})</span></span>
                    <span className="flex gap-1">
                      {(['RESELLABLE', 'DAMAGED'] as const).map((c) => (
                        <button key={c} type="button" onClick={() => setConditions({ ...conditions, [i.id]: c })} aria-pressed={conditions[i.id] === c}
                          className={cx('rounded-sm border px-2.5 py-1.5 text-xs font-semibold', conditions[i.id] === c ? 'border-ink bg-ink text-paper' : 'border-line')}>
                          {c === 'RESELLABLE' ? 'Resellable' : 'Damaged'}
                        </button>
                      ))}
                    </span>
                  </div>
                ))}
                {r.type === 'EXCHANGE' && (
                  <fieldset className="rounded-sm bg-ivory p-3 text-sm">
                    <legend className="sr-only">Settle as</legend>
                    <label className="flex gap-2"><input type="radio" className="accent-ink" checked={resolution === 'EXCHANGE'} onChange={() => setResolution('EXCHANGE')} /> Send the exchange (free replacement order)</label>
                    <label className="mt-1 flex gap-2"><input type="radio" className="accent-ink" checked={resolution === 'REFUND'} onChange={() => setResolution('REFUND')} /> Refund instead (e.g. replacement sold out)</label>
                  </fieldset>
                )}
              </>
            )}
            {modal !== 'receive' && (
              <TextArea label={modal === 'approve' ? 'Instructions for the customer (optional)' : 'Reason (shared with the customer)'} value={text} onChange={(e) => setText(e.target.value)} rows={3} />
            )}
            <div className="flex gap-2">
              <Button variant={modal === 'reject' ? 'danger' : 'primary'} loading={act.isPending}
                disabled={modal === 'reject' && text.trim().length < 3}
                onClick={() => act.mutate(modal === 'approve' ? { path: 'approve', body: { note: text.trim() || undefined } }
                  : modal === 'reject' ? { path: 'reject', body: { reason: text.trim() } }
                  : { path: 'receive', body: { items: r.items.map((i) => ({ returnItemId: i.id, condition: conditions[i.id] ?? 'RESELLABLE' })), resolution: r.type === 'EXCHANGE' ? resolution : 'REFUND' } })}>
                {modal === 'approve' ? 'Approve' : modal === 'reject' ? 'Reject' : 'Confirm receipt'}
              </Button>
              <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
