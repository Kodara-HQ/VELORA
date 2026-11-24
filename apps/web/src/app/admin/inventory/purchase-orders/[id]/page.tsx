'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageHeader, Panel, QueryState, StatusPill, Table, Td } from '@/components/admin/ui';
import { Alert, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface Po {
  id: number; poNumber: string; status: string; totalCost: string; note: string | null; expectedAt: string | null; createdAt: string;
  supplier: { name: string }; warehouse: { code: string; name: string };
  items: Array<{ id: number; quantityOrdered: number; quantityReceived: number; unitCost: string; variant: { sku: string; color: string | null; size: string | null; product: { name: string } } }>;
  receipts: Array<{ id: number; receiptNumber: string; receivedAt: string; note: string | null; items: Array<{ purchaseOrderItemId: number; quantityReceived: number; quantityRejected: number }> }>;
}

export default function PoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const canManage = useCan('purchase_orders.manage');
  const canReceive = useCan('goods.receive');
  const [recv, setRecv] = useState<Record<number, { ok: string; rej: string }>>({});
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['admin-po', id], queryFn: () => api<Po>(`/admin/purchase-orders/${id}`) });
  const act = useMutation({
    mutationFn: (a: { path: string; body?: unknown }) => api<Po>(`/admin/purchase-orders/${id}${a.path}`, { method: 'POST', body: a.body ?? {} }),
    onSuccess: (po) => {
      qc.setQueryData(['admin-po', id], po);
      void qc.invalidateQueries({ queryKey: ['admin-pos'] });
      void qc.invalidateQueries({ queryKey: ['admin-stock'] });
      setRecv({}); setNote('');
    },
  });
  const po = q.data;
  const receiving = po && (po.status === 'ORDERED' || po.status === 'PARTIALLY_RECEIVED') && canReceive;

  return (
    <>
      <PageHeader title={po?.poNumber ?? 'Purchase order'} back={{ href: '/admin/inventory/purchase-orders', label: 'Purchase orders' }}
        description={po && <span className="flex flex-wrap items-center gap-2"><StatusPill status={po.status} /> {po.supplier.name} → {po.warehouse.name}{po.expectedAt && ` · expected ${new Date(po.expectedAt).toLocaleDateString('en-GB')}`}</span>}
        actions={po && canManage && <>
          {po.status === 'DRAFT' && <Button onClick={() => act.mutate({ path: '/order' })} loading={act.isPending}>Mark as sent to supplier</Button>}
          {(po.status === 'DRAFT' || po.status === 'ORDERED') && <Button variant="danger" onClick={() => window.confirm('Cancel this purchase order?') && act.mutate({ path: '/cancel' })}>Cancel PO</Button>}
        </>} />
      {act.isError && <div className="mb-4"><Alert tone="danger">{errorMessage(act.error)}</Alert></div>}
      {act.isSuccess && <div className="mb-4"><Alert tone="success">Saved.</Alert></div>}
      <QueryState q={q}>
        {po && (
          <div className="space-y-6">
            <Panel title="Lines" padded={false}>
              <Table head={['Variant', 'Unit cost', 'Ordered', 'Received', 'Outstanding', ...(receiving ? ['Receive now', 'Rejected'] : [])]}>
                {po.items.map((i) => {
                  const out = i.quantityOrdered - i.quantityReceived;
                  return (
                    <tr key={i.id}>
                      <Td>{i.variant.product.name}<span className="block font-mono text-xs text-muted">{i.variant.sku} · {[i.variant.color, i.variant.size].filter(Boolean).join(' / ')}</span></Td>
                      <Td>{formatMoney(i.unitCost)}</Td><Td>{i.quantityOrdered}</Td><Td>{i.quantityReceived}</Td>
                      <Td className={out ? 'font-semibold' : 'text-muted'}>{out}</Td>
                      {receiving && <>
                        <Td><input disabled={!out} inputMode="numeric" aria-label={`Receive ${i.variant.sku}`} value={recv[i.id]?.ok ?? ''} placeholder="0"
                          onChange={(e) => setRecv({ ...recv, [i.id]: { ok: e.target.value.replace(/\D/g, ''), rej: recv[i.id]?.rej ?? '' } })} className="h-9 w-20 rounded-sm border border-line px-2" /></Td>
                        <Td><input disabled={!out} inputMode="numeric" aria-label={`Rejected ${i.variant.sku}`} value={recv[i.id]?.rej ?? ''} placeholder="0"
                          onChange={(e) => setRecv({ ...recv, [i.id]: { ok: recv[i.id]?.ok ?? '', rej: e.target.value.replace(/\D/g, '') } })} className="h-9 w-20 rounded-sm border border-line px-2" /></Td>
                      </>}
                    </tr>
                  );
                })}
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4">
                <p className="text-sm">Total cost <b>{formatMoney(po.totalCost)}</b></p>
                {receiving && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Delivery note / waybill no." className="h-10 w-64 rounded-sm border border-line px-3 text-sm" />
                    <Button loading={act.isPending} disabled={!Object.values(recv).some((r) => Number(r.ok) > 0)}
                      onClick={() => act.mutate({ path: '/receive', body: { note: note || undefined, items: Object.entries(recv).filter(([, r]) => Number(r.ok) > 0 || Number(r.rej) > 0)
                        .map(([k, r]) => ({ purchaseOrderItemId: Number(k), quantityReceived: Number(r.ok || 0), quantityRejected: Number(r.rej || 0) })) } })}>
                      Record goods received
                    </Button>
                  </div>
                )}
              </div>
            </Panel>
            <Panel title={`Goods received notes (${po.receipts.length})`}>
              {!po.receipts.length ? <p className="text-sm text-muted">Nothing received yet.</p> : (
                <ul className="space-y-2 text-sm">
                  {po.receipts.map((r) => (
                    <li key={r.id}><b className="font-mono text-xs">{r.receiptNumber}</b> · {formatDateTime(r.receivedAt)} · {r.items.reduce((s, x) => s + x.quantityReceived, 0)} accepted
                      {r.items.some((x) => x.quantityRejected) && `, ${r.items.reduce((s, x) => s + x.quantityRejected, 0)} rejected`}{r.note && ` · ${r.note}`}</li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        )}
      </QueryState>
    </>
  );
}
