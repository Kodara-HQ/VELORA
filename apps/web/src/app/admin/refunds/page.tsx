'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { FilterSelect, humanize, PageHeader, Pager, Panel, QueryState, SearchInput, Select, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { Dialog } from '@/components/dialog';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatDateTime, formatMoney } from '@/lib/format';
import { errorMessage } from '@/lib/shop';

interface RefundRow {
  id: number; amount: string; status: string; reason: string; method: string | null; providerReference: string | null; note: string | null; createdAt: string; processedAt: string | null;
  order: { orderNumber: string; guestEmail: string | null; guestPhone: string | null; grandTotal: string };
  payment: { reference: string; provider: string; method: string; payerPhone: string | null; cardLast4: string | null } | null;
  return: { returnNumber: string } | null; processedBy: string | null; gatewayRefundable: boolean;
}

function Inner() {
  const f = useUrlFilters();
  const qc = useQueryClient();
  const [processing, setProcessing] = useState<RefundRow | null>(null);
  const query = { q: f.get('q'), status: f.get('status') || 'REQUESTED', page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['admin-refunds', query], queryFn: () => apiWithMeta<RefundRow[]>(`/admin/refunds${qs({ ...query, status: query.status === 'ALL' ? '' : query.status })}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Refunds" description="Card and MoMo payments taken online can be refunded through the provider. Cash-on-delivery refunds are paid out manually and recorded here." />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Order number" />
        <FilterSelect label="Status" value={f.get('status') || 'REQUESTED'} onChange={(v) => f.set('status', v)}
          options={[['REQUESTED', 'To process'], ['PROCESSING', 'With provider'], ['COMPLETED', 'Completed'], ['REJECTED', 'Rejected'], ['ALL', 'All']]} />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="Nothing to process.">
          <Table head={['Order', 'Reason', 'Paid with', 'Amount', 'Status', 'Requested', '']}>
            {q.data?.data.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/admin/orders/${r.order.orderNumber}`} className="font-semibold hover:underline">{r.order.orderNumber}</Link>
                  {r.return && <span className="block font-mono text-xs text-muted">{r.return.returnNumber}</span>}</Td>
                <Td className="max-w-64">{r.reason}</Td>
                <Td className="text-xs">{r.payment ? <>{humanize(r.payment.provider)} · {humanize(r.payment.method)}{r.payment.cardLast4 && ` ••${r.payment.cardLast4}`}{r.payment.payerPhone && <span className="block text-muted">{r.payment.payerPhone}</span>}</> : 'Not paid online'}</Td>
                <Td className="font-semibold">{formatMoney(r.amount)}</Td>
                <Td><StatusPill status={r.status} />{r.providerReference && <span className="block font-mono text-[10px] text-muted">{r.providerReference}</span>}{r.processedBy && <span className="block text-[10px] text-muted">by {r.processedBy}</span>}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(r.createdAt)}</Td>
                <Td>{(r.status === 'REQUESTED' || r.status === 'APPROVED') && <Button size="sm" onClick={() => setProcessing(r)}>Process</Button>}</Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
      {processing && <ProcessDialog refund={processing} onClose={() => setProcessing(null)} onDone={() => { setProcessing(null); void qc.invalidateQueries({ queryKey: ['admin-refunds'] }); }} />}
    </>
  );
}

function ProcessDialog({ refund, onClose, onDone }: { refund: RefundRow; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'GATEWAY' | 'MANUAL' | 'REJECT'>(refund.gatewayRefundable ? 'GATEWAY' : 'MANUAL');
  const [method, setMethod] = useState('MOMO');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const go = useMutation({
    mutationFn: () => mode === 'REJECT'
      ? api(`/admin/refunds/${refund.id}/reject`, { method: 'POST', body: { reason: note } })
      : api(`/admin/refunds/${refund.id}/process`, { method: 'POST', body: { mode, ...(mode === 'MANUAL' && { method, reference }), note: note || undefined } }),
    onSuccess: onDone,
  });
  const errs = go.error instanceof ApiError ? go.error.fieldErrors : {};
  return (
    <Dialog open onClose={onClose} label="Process refund" className="max-w-lg">
      <div className="space-y-4 p-6">
        <h2 className="text-xl font-extrabold">Refund {formatMoney(refund.amount)}</h2>
        <p className="text-sm text-muted">Order {refund.order.orderNumber} · {refund.reason}{refund.order.guestPhone && ` · customer ${refund.order.guestPhone}`}</p>
        {go.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(go.error)}</Alert>}
        <fieldset className="space-y-2 text-sm">
          <legend className="sr-only">How</legend>
          {refund.gatewayRefundable && (
            <label className="flex gap-2"><input type="radio" className="mt-0.5 accent-ink" checked={mode === 'GATEWAY'} onChange={() => setMode('GATEWAY')} />
              <span><b>Back to the original payment</b><span className="block text-muted">Sent through {humanize(refund.payment!.provider)} to the customer’s card or MoMo wallet.</span></span></label>
          )}
          <label className="flex gap-2"><input type="radio" className="mt-0.5 accent-ink" checked={mode === 'MANUAL'} onChange={() => setMode('MANUAL')} />
            <span><b>I paid it out manually</b><span className="block text-muted">Record the MoMo or bank transfer you sent.</span></span></label>
          <label className="flex gap-2"><input type="radio" className="mt-0.5 accent-ink" checked={mode === 'REJECT'} onChange={() => setMode('REJECT')} />
            <span><b>Decline this refund</b></span></label>
        </fieldset>
        {mode === 'MANUAL' && (
          <div className="grid grid-cols-2 gap-3">
            <Select label="Paid via" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="MOMO">Mobile Money</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CASH">Cash</option><option value="STORE_CREDIT">Store credit</option>
            </Select>
            <Field label="Transaction reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 4410923381" error={errs.reference} />
          </div>
        )}
        <Field label={mode === 'REJECT' ? 'Reason (required)' : 'Internal note (optional)'} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex gap-2">
          <Button variant={mode === 'REJECT' ? 'danger' : 'primary'} loading={go.isPending}
            disabled={(mode === 'MANUAL' && reference.trim().length < 4) || (mode === 'REJECT' && note.trim().length < 3)}
            onClick={() => go.mutate()}>{mode === 'REJECT' ? 'Decline refund' : mode === 'GATEWAY' ? `Refund ${formatMoney(refund.amount)}` : 'Record payout'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}

export default function RefundsPage() {
  return <Suspense><Inner /></Suspense>;
}
