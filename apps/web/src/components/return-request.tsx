'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { cx } from '@/lib/cx';
import { formatMoney } from '@/lib/format';
import { errorMessage } from '@/lib/shop';
import { RETURN_REASONS, type ReturnRequest } from '@/lib/types';
import { Dialog } from './dialog';
import { Alert, Button, Skeleton } from './ui';

interface Returnable {
  eligible: boolean; reason: string | null; deadline: string | null;
  lines: Array<{ sku: string; name: string; variantLabel: string | null; image: string | null; returnable: number; unitPaid: string;
    exchangeOptions: Array<{ variantId: number; sku: string; label: string; inStock: boolean }> }>;
}

export function ReturnRequestDialog({ orderNumber, onClose, onDone }: { orderNumber: string; onClose: () => void; onDone: (r: ReturnRequest) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['returnable', orderNumber], queryFn: () => api<Returnable>(`/me/orders/${orderNumber}/returnable`) });
  const [type, setType] = useState<'RETURN' | 'EXCHANGE'>('RETURN');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pick, setPick] = useState<Record<string, { qty: number; exchange?: number }>>({});
  const submit = useMutation({
    mutationFn: () => api<ReturnRequest>(`/me/orders/${orderNumber}/returns`, {
      method: 'POST',
      body: { type, reason, note: note.trim() || undefined, items: Object.entries(pick).filter(([, p]) => p.qty > 0).map(([sku, p]) => ({ sku, quantity: p.qty, ...(type === 'EXCHANGE' && { exchangeVariantId: p.exchange }) })) },
    }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['order', orderNumber] });
      void qc.invalidateQueries({ queryKey: ['my-returns'] });
      onDone(r);
    },
  });
  const chosen = Object.entries(pick).filter(([, p]) => p.qty > 0);
  const refundEstimate = q.data ? chosen.reduce((s, [sku, p]) => s + Number(q.data.lines.find((l) => l.sku === sku)?.unitPaid ?? 0) * p.qty, 0) : 0;
  const valid = chosen.length > 0 && reason && (type === 'RETURN' || chosen.every(([, p]) => p.exchange));
  const fieldErr = submit.error instanceof ApiError ? submit.error.fieldErrors : {};

  return (
    <Dialog open onClose={onClose} label="Request a return" className="max-w-2xl">
      <div className="space-y-5 p-6 sm:p-8">
        <h2 className="text-2xl font-extrabold">Return or exchange</h2>
        {q.isPending ? <Skeleton className="h-40" /> : q.isError ? <Alert tone="danger">{errorMessage(q.error)}</Alert> : !q.data.eligible ? (
          <Alert tone="warning">{q.data.reason}</Alert>
        ) : (
          <>
            {q.data.deadline && <p className="text-sm text-muted">Free returns until {new Date(q.data.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.</p>}
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What would you like?">
              {([['RETURN', 'Refund', 'Money back to your original payment method or MoMo'], ['EXCHANGE', 'Exchange', 'Swap for another size or colour, free']] as const).map(([v, label, hint]) => (
                <button key={v} type="button" role="radio" aria-checked={type === v} onClick={() => setType(v)}
                  className={cx('rounded-sm border p-3 text-left text-sm', type === v ? 'border-ink bg-paper' : 'border-line')}>
                  <span className="font-semibold">{label}</span><span className="block text-xs text-muted">{hint}</span>
                </button>
              ))}
            </div>
            <ul className="divide-y divide-line rounded-sm border border-line">
              {q.data.lines.map((l) => {
                const p = pick[l.sku] ?? { qty: 0 };
                return (
                  <li key={l.sku} className={cx('flex flex-wrap items-center gap-3 p-3 text-sm', !l.returnable && 'opacity-50')}>
                    <span className="h-14 w-11 shrink-0 overflow-hidden rounded-sm bg-sand">{l.image && <img src={l.image} alt="" className="h-full w-full object-cover" />}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{l.name}</span><span className="text-xs text-muted">{l.variantLabel} · {formatMoney(l.unitPaid)} each</span></span>
                    {l.returnable ? (
                      <select aria-label={`Quantity to return of ${l.name}`} value={p.qty} onChange={(e) => setPick({ ...pick, [l.sku]: { ...p, qty: Number(e.target.value) } })} className="h-10 rounded-sm border border-line bg-paper px-2">
                        {Array.from({ length: l.returnable + 1 }, (_, i) => <option key={i} value={i}>{i === 0 ? 'Keep' : `Return ${i}`}</option>)}
                      </select>
                    ) : <span className="text-xs text-muted">Already returned</span>}
                    {type === 'EXCHANGE' && p.qty > 0 && (
                      <select aria-label={`Exchange ${l.name} for`} value={p.exchange ?? ''} onChange={(e) => setPick({ ...pick, [l.sku]: { ...p, exchange: Number(e.target.value) || undefined } })} className="h-10 w-full rounded-sm border border-line bg-paper px-2 sm:w-auto">
                        <option value="">Swap for…</option>
                        {l.exchangeOptions.map((o) => <option key={o.variantId} value={o.variantId} disabled={!o.inStock}>{o.label}{!o.inStock ? ' (sold out)' : ''}</option>)}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.12em]">Reason</span>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1.5 block h-11 w-full rounded-sm border border-line bg-paper px-3 text-sm">
                <option value="">Choose a reason</option>
                {Object.entries(RETURN_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {fieldErr.reason && <span className="text-[13px] text-danger">{fieldErr.reason}</span>}
            </label>
            <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} rows={2} placeholder="Anything we should know? (optional)" className="w-full rounded-sm border border-line bg-paper p-3 text-sm" />
            {submit.isError && <Alert tone="danger">{errorMessage(submit.error)}</Alert>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">{type === 'RETURN' && refundEstimate > 0 ? <>Estimated refund <b className="text-ink">{formatMoney(refundEstimate)}</b>, once we receive the items.</> : 'We’ll confirm by email with drop-off or pick-up details.'}</p>
              <Button onClick={() => submit.mutate()} loading={submit.isPending} disabled={!valid}>Submit request</Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
