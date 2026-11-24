'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { AddressText } from '@/components/address-form';
import { humanize, PageHeader, Panel, QueryState, Select, StatusPill, Table, Td } from '@/components/admin/ui';
import { Dialog } from '@/components/dialog';
import { Row } from '@/components/shop-overlays';
import { Alert, Badge, Button, ButtonLink, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';
import type { AdminOrder } from '@/components/admin/types';


type Modal = 'ship' | 'cancel' | 'note' | { event: number } | null;

export default function AdminOrderPage() {
  const { number } = useParams<{ number: string }>();
  const qc = useQueryClient();
  const canShip = useCan('shipments.manage');
  const canCancel = useCan('orders.cancel');
  const canNote = useCan('orders.manage');
  const [modal, setModal] = useState<Modal>(null);
  const q = useQuery({ queryKey: ['admin-order', number], queryFn: () => api<AdminOrder>(`/admin/orders/${number}`) });
  const act = useMutation({
    mutationFn: (a: { path: string; body?: unknown }) => api<AdminOrder>(a.path, { method: 'POST', body: a.body ?? {} }),
    onSuccess: (o) => {
      qc.setQueryData(['admin-order', number], o);
      void qc.invalidateQueries({ queryKey: ['admin-orders'] });
      void qc.invalidateQueries({ queryKey: ['admin-notifications'] });
      setModal(null);
    },
  });
  const o = q.data;

  return (
    <>
      <PageHeader title={`Order ${number}`} back={{ href: '/admin/orders', label: 'Orders' }}
        description={o && <span className="flex flex-wrap items-center gap-2"><StatusPill status={o.status} /><StatusPill status={o.paymentStatus} /> placed {formatDateTime(o.placedAt)} via {o.channel}</span>}
        actions={o && <>
          {o.can.ship && canShip && <Button onClick={() => { act.reset(); setModal('ship'); }}>Dispatch order</Button>}
          {o.can.deliver && canShip && <Button onClick={() => window.confirm(o.payment?.method === 'CASH' ? `Confirm delivery and that ${formatMoney(o.grandTotal)} was collected?` : 'Confirm delivery?') && act.mutate({ path: `/admin/orders/${number}/deliver` })} loading={act.isPending}>Mark delivered</Button>}
          <ButtonLink href={`/admin/orders/${number}/print?doc=invoice`} variant="secondary">Invoice</ButtonLink>
          <ButtonLink href={`/admin/orders/${number}/print?doc=packing`} variant="secondary">Packing slip</ButtonLink>
          {o.can.cancel && canCancel && <Button variant="danger" onClick={() => { act.reset(); setModal('cancel'); }}>Cancel</Button>}
        </>} />
      {act.isError && !modal && <div className="mb-4"><Alert tone="danger">{errorMessage(act.error)}</Alert></div>}
      <QueryState q={q}>
        {o && (
          <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
            <div className="space-y-6">
              {o.customerNote && <Alert tone="info" title="Customer note">{o.customerNote}</Alert>}
              <Panel title={`Items (${o.itemCount})`} padded={false}>
                <Table head={['Item', 'SKU', 'Warehouse', 'Unit', 'Qty', 'Discount', 'Total']}>
                  {o.lines.map((l) => (
                    <tr key={l.id}>
                      <Td>
                        <span className="flex items-center gap-3">
                          <span className="h-12 w-9 shrink-0 overflow-hidden rounded-sm bg-sand">{l.image && <img src={l.image} alt="" className="h-full w-full object-cover" />}</span>
                          <span>{l.productId ? <Link href={`/admin/products/${l.productId}`} className="font-medium hover:underline">{l.name}</Link> : l.name}
                            <span className="block text-xs text-muted">{l.variantLabel}{l.vendor && ` · sold by ${l.vendor}`}</span></span>
                        </span>
                      </Td>
                      <Td className="font-mono text-xs">{l.sku}</Td>
                      <Td>{l.warehouse ?? '—'}</Td>
                      <Td>{formatMoney(l.unitPrice)}</Td>
                      <Td>{l.quantity}</Td>
                      <Td>{Number(l.discount) ? `−${formatMoney(l.discount)}` : '—'}</Td>
                      <Td className="text-right font-semibold">{formatMoney(l.lineTotal)}</Td>
                    </tr>
                  ))}
                </Table>
                <div className="ml-auto max-w-xs space-y-1.5 p-5">
                  <Row label="Subtotal" value={formatMoney(o.subtotal)} />
                  {Number(o.discountTotal) > 0 && <Row label={`Discount${o.couponCode ? ` (${o.couponCode})` : ''}`} value={`−${formatMoney(o.discountTotal)}`} accent />}
                  <Row label="Delivery" value={formatMoney(o.shippingTotal)} />
                  {Number(o.taxTotal) > 0 && <Row label="Tax" value={formatMoney(o.taxTotal)} />}
                  <div className="border-t border-line pt-2"><Row label="Total" value={formatMoney(o.grandTotal)} strong /></div>
                </div>
              </Panel>

              <Panel title="Shipments">
                {!o.shipmentsFull.length ? <p className="text-sm text-muted">Not dispatched yet.</p> : o.shipmentsFull.map((s) => (
                  <div key={s.id} className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <b>{s.carrier}</b> <span className="font-mono">{s.trackingNumber}</span> <StatusPill status={s.status} />
                      {s.riderName && <span className="text-muted">Rider: {s.riderName} {s.riderPhone}</span>}
                      {o.status === 'SHIPPED' && canShip && <button type="button" className="ml-auto text-xs font-semibold underline" onClick={() => setModal({ event: s.id })}>Add tracking update</button>}
                    </div>
                    <ol className="space-y-2 border-l border-line pl-4 text-sm">
                      {s.events.map((e) => <li key={e.id}><b>{humanize(e.status)}</b> · {e.description}{e.location && ` · ${e.location}`} <span className="text-xs text-muted">{formatDateTime(e.occurredAt)}</span></li>)}
                    </ol>
                  </div>
                ))}
              </Panel>

              <Panel title="History" actions={canNote && <button type="button" className="text-xs font-semibold underline" onClick={() => { act.reset(); setModal('note'); }}>Add note</button>}>
                <ol className="space-y-3 text-sm">
                  {[...o.historyFull].reverse().map((h, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ink" />
                      <span><b>{humanize(h.status)}</b>{h.note && ` · ${h.note}`}<span className="block text-xs text-muted">{formatDateTime(h.at)}{h.by && ` · ${h.by}`}</span></span>
                    </li>
                  ))}
                </ol>
              </Panel>
            </div>

            <div className="space-y-6">
              <Panel title="Customer">
                {o.customer ? (
                  <div className="space-y-1 text-sm">
                    <Link href={`/admin/customers/${o.customer.id}`} className="font-semibold hover:underline">{o.customer.firstName} {o.customer.lastName}</Link>
                    <p>{o.customer.email}</p>
                    {o.customer.customer && <p className="text-muted">{o.customer.customer.orderCount} orders · {formatMoney(o.customer.customer.lifetimeValue)} lifetime</p>}
                  </div>
                ) : (
                  <div className="space-y-1 text-sm"><Badge tone="outline">Guest</Badge><p>{o.email}</p><p>{o.guestPhone}</p></div>
                )}
              </Panel>
              <Panel title="Delivery address"><AddressText a={o.shippingAddress as never} />{o.shippingMethod && <p className="mt-3 text-sm text-muted">{o.shippingMethod.name}</p>}</Panel>
              <Panel title="Payment">
                {o.payments.map((p) => (
                  <div key={p.reference} className="space-y-1 text-sm">
                    <p className="flex items-center gap-2"><b>{p.method === 'CASH' ? 'Pay on delivery' : humanize(p.method)}</b> <StatusPill status={p.status} /></p>
                    <p className="font-mono text-xs text-muted">{p.reference}</p>
                    <p>{formatMoney(p.amount)}</p>
                  </div>
                ))}
                {o.refunds.map((r) => <p key={r.id} className="mt-3 text-sm">Refund {formatMoney(r.amount)} · <StatusPill status={r.status} /> · {r.reason}</p>)}
              </Panel>
            </div>
          </div>
        )}
      </QueryState>

      {modal === 'ship' && (
        <FormDialog title="Dispatch order" submit="Dispatch" onClose={() => setModal(null)} pending={act.isPending} error={act.error}
          onSubmit={(f) => act.mutate({ path: `/admin/orders/${number}/ship`, body: { carrier: f.carrier, trackingNumber: f.trackingNumber || undefined, riderName: f.riderName || undefined, riderPhone: f.riderPhone || undefined } })}
          fields={[['carrier', 'Carrier', 'VÉLORA Dispatch'], ['trackingNumber', 'Tracking number (optional)', ''], ['riderName', 'Rider name (optional)', ''], ['riderPhone', 'Rider phone (optional, +233…)', '']]}
          intro="Reserved stock is deducted from the warehouse and the customer sees the order as on its way." />
      )}
      {modal === 'cancel' && (
        <FormDialog title="Cancel order" submit="Cancel order" danger onClose={() => setModal(null)} pending={act.isPending} error={act.error}
          onSubmit={(f) => act.mutate({ path: `/admin/orders/${number}/cancel`, body: { reason: f.reason } })}
          fields={[['reason', 'Reason (shared with the customer)', '']]} intro="Reserved stock is released. Paid orders get a refund request for Finance." />
      )}
      {modal === 'note' && (
        <FormDialog title="Add internal note" submit="Add note" onClose={() => setModal(null)} pending={act.isPending} error={act.error}
          onSubmit={(f) => act.mutate({ path: `/admin/orders/${number}/notes`, body: { note: f.note } })} fields={[['note', 'Note', '']]} />
      )}
      {modal && typeof modal === 'object' && <TrackingDialog shipmentId={modal.event} onClose={() => setModal(null)} pending={act.isPending} error={act.error}
        onSubmit={(body) => act.mutate({ path: `/admin/shipments/${modal.event}/events`, body })} />}
    </>
  );
}

function FormDialog({ title, intro, fields, submit, danger, onSubmit, onClose, pending, error }: {
  title: string; intro?: ReactNode; fields: Array<[string, string, string]>; submit: string; danger?: boolean;
  onSubmit: (v: Record<string, string>) => void; onClose: () => void; pending: boolean; error: unknown;
}) {
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(fields.map(([k, , d]) => [k, d])));
  const errs = error instanceof ApiError ? error.fieldErrors : {};
  return (
    <Dialog open onClose={onClose} label={title} className="max-w-md">
      <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
        <h2 className="text-xl font-extrabold">{title}</h2>
        {intro && <p className="text-sm text-muted">{intro}</p>}
        {!!error && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(error)}</Alert>}
        {fields.map(([k, label]) => <Field key={k} label={label} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} error={errs[k]} />)}
        <div className="flex gap-2 pt-2"><Button type="submit" variant={danger ? 'danger' : 'primary'} loading={pending}>{submit}</Button><Button variant="ghost" onClick={onClose}>Close</Button></div>
      </form>
    </Dialog>
  );
}

function TrackingDialog({ onSubmit, onClose, pending, error }: { shipmentId: number; onSubmit: (b: unknown) => void; onClose: () => void; pending: boolean; error: unknown }) {
  const [v, setV] = useState({ status: 'IN_TRANSIT', description: '', location: '' });
  return (
    <Dialog open onClose={onClose} label="Tracking update" className="max-w-md">
      <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); onSubmit({ ...v, location: v.location || undefined }); }}>
        <h2 className="text-xl font-extrabold">Tracking update</h2>
        {!!error && <Alert tone="danger">{errorMessage(error)}</Alert>}
        <Select label="Status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>
          {['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'FAILED_ATTEMPT', 'RETURNED_TO_SENDER'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </Select>
        <Field label="Description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="Arrived at Kumasi hub" required />
        <Field label="Location (optional)" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
        <div className="flex gap-2 pt-2"><Button type="submit" loading={pending}>Save update</Button><Button variant="ghost" onClick={onClose}>Close</Button></div>
      </form>
    </Dialog>
  );
}
