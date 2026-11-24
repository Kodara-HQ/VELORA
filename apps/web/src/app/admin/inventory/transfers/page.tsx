'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useWarehouses, VariantSearch, type StockRow } from '@/components/admin/inventory-shared';
import { PageHeader, Panel, QueryState, Select, StatusPill, Table, Td } from '@/components/admin/ui';
import { Dialog } from '@/components/dialog';
import { Alert, Button } from '@/components/ui';
import { apiWithMeta, api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface Transfer {
  id: number; transferNumber: string; status: string; note: string | null; createdAt: string; shippedAt: string | null; receivedAt: string | null;
  fromWarehouse: { code: string }; toWarehouse: { code: string };
  items: Array<{ id: number; quantity: number; variant: { sku: string; color: string | null; size: string | null; product: { name: string } } }>;
}

export default function TransfersPage() {
  const qc = useQueryClient();
  const can = useCan('inventory.transfer');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['admin-transfers'], queryFn: () => apiWithMeta<Transfer[]>('/admin/stock-transfers?pageSize=50') });
  const act = useMutation({
    mutationFn: ({ id, step }: { id: number; step: 'dispatch' | 'receive' | 'cancel' }) => api(`/admin/stock-transfers/${id}/${step}`, { method: 'POST', body: {} }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-transfers'] }); void qc.invalidateQueries({ queryKey: ['admin-stock'] }); },
  });

  return (
    <>
      <PageHeader title="Stock transfers" description="Move stock between warehouses: dispatch deducts from the source, receive adds to the destination."
        actions={can && <Button onClick={() => setCreating(true)}>New transfer</Button>} />
      {act.isError && <div className="mb-4"><Alert tone="danger">{errorMessage(act.error)}</Alert></div>}
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No transfers yet.">
          <Table head={['Transfer', 'Route', 'Items', 'Status', 'Created', '']}>
            {q.data?.data.map((t) => (
              <tr key={t.id}>
                <Td className="font-mono text-xs font-semibold">{t.transferNumber}{t.note && <span className="block font-sans font-normal text-muted">{t.note}</span>}</Td>
                <Td>{t.fromWarehouse.code} → {t.toWarehouse.code}</Td>
                <Td><ul className="text-xs">{t.items.map((i) => <li key={i.id}>{i.quantity} × {i.variant.product.name} <span className="font-mono text-muted">{i.variant.sku}</span></li>)}</ul></Td>
                <Td><StatusPill status={t.status} /></Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(t.createdAt)}</Td>
                <Td className="whitespace-nowrap">
                  {can && t.status === 'DRAFT' && <>
                    <Button size="sm" onClick={() => act.mutate({ id: t.id, step: 'dispatch' })} loading={act.isPending && act.variables?.id === t.id}>Dispatch</Button>{' '}
                    <button type="button" className="ml-2 text-xs font-semibold text-danger underline" onClick={() => act.mutate({ id: t.id, step: 'cancel' })}>Cancel</button>
                  </>}
                  {can && t.status === 'IN_TRANSIT' && <Button size="sm" onClick={() => act.mutate({ id: t.id, step: 'receive' })} loading={act.isPending && act.variables?.id === t.id}>Receive</Button>}
                </Td>
              </tr>
            ))}
          </Table>
        </QueryState>
      </Panel>
      {creating && <NewTransfer onClose={() => setCreating(false)} onDone={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ['admin-transfers'] }); }} />}
    </>
  );
}

function NewTransfer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const whs = useWarehouses();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Array<{ row: StockRow; qty: string }>>([]);
  const save = useMutation({
    mutationFn: () => api('/admin/stock-transfers', { method: 'POST', body: { fromWarehouseId: Number(from), toWarehouseId: Number(to), note: note || undefined, items: lines.map((l) => ({ variantId: l.row.variantId, quantity: Number(l.qty) })) } }),
    onSuccess: onDone,
  });
  const avail = (r: StockRow) => r.warehouses.find((w) => String(w.warehouseId) === from)?.available ?? 0;
  return (
    <Dialog open onClose={onClose} label="New transfer" className="max-w-2xl">
      <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2 className="text-xl font-extrabold">New stock transfer</h2>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Select label="From" value={from} onChange={(e) => setFrom(e.target.value)} required><option value="">Choose…</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
          <Select label="To" value={to} onChange={(e) => setTo(e.target.value)} required><option value="">Choose…</option>{whs.data?.filter((w) => String(w.id) !== from).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
        </div>
        <VariantSearch exclude={lines.map((l) => l.row.variantId)} onPick={(row) => setLines([...lines, { row, qty: '1' }])} />
        {lines.length > 0 && (
          <ul className="divide-y divide-line rounded-sm border border-line">
            {lines.map((l, i) => (
              <li key={l.row.variantId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{l.row.product.name} <span className="font-mono text-xs text-muted">{l.row.sku}</span></span>
                {from && <span className="text-xs text-muted">{avail(l.row)} available</span>}
                <input value={l.qty} inputMode="numeric" aria-label="Quantity" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/\D/g, '') } : x)))}
                  className="h-9 w-20 rounded-sm border border-line px-2" />
                <button type="button" className="text-xs font-semibold text-danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-10 w-full rounded-sm border border-line px-3 text-sm" />
        <div className="flex gap-2"><Button type="submit" loading={save.isPending} disabled={!from || !to || !lines.length || lines.some((l) => !Number(l.qty))}>Create draft</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}
