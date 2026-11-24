'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useWarehouses, VariantSearch, type StockRow } from '@/components/admin/inventory-shared';
import { PageHeader, Panel, QueryState, Select, StatusPill, Table, Td } from '@/components/admin/ui';
import { Dialog } from '@/components/dialog';
import { Alert, Button } from '@/components/ui';
import { api, apiWithMeta } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface PoRow { id: number; poNumber: string; status: string; totalCost: string; expectedAt: string | null; createdAt: string; supplier: { name: string }; warehouse: { code: string }; ordered: number; received: number }
interface Supplier { id: number; name: string; isActive: boolean }

export default function PurchaseOrdersPage() {
  const qc = useQueryClient();
  const can = useCan('purchase_orders.manage');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['admin-pos'], queryFn: () => apiWithMeta<PoRow[]>('/admin/purchase-orders?pageSize=50') });
  return (
    <>
      <PageHeader title="Purchase orders" description="Order from suppliers, then record goods received to add stock at cost."
        actions={can && <Button onClick={() => setCreating(true)}>New purchase order</Button>} />
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No purchase orders yet.">
          <Table head={['PO', 'Supplier', 'Deliver to', 'Received', 'Total cost', 'Status', 'Created']}>
            {q.data?.data.map((p) => (
              <tr key={p.id} className="hover:bg-ivory">
                <Td><Link href={`/admin/inventory/purchase-orders/${p.id}`} className="font-mono text-xs font-semibold hover:underline">{p.poNumber}</Link></Td>
                <Td>{p.supplier.name}</Td><Td>{p.warehouse.code}</Td>
                <Td>{p.received} / {p.ordered}</Td><Td>{formatMoney(p.totalCost)}</Td><Td><StatusPill status={p.status} /></Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(p.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        </QueryState>
      </Panel>
      {creating && <NewPo onClose={() => setCreating(false)} onDone={() => { setCreating(false); void qc.invalidateQueries({ queryKey: ['admin-pos'] }); }} />}
    </>
  );
}

function NewPo({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const whs = useWarehouses();
  const suppliers = useQuery({ queryKey: ['admin-suppliers'], queryFn: () => api<Supplier[]>('/admin/suppliers') });
  const [v, setV] = useState({ supplierId: '', warehouseId: '', expectedAt: '', note: '' });
  const [lines, setLines] = useState<Array<{ row: StockRow; qty: string; cost: string }>>([]);
  const save = useMutation({
    mutationFn: () => api('/admin/purchase-orders', { method: 'POST', body: {
      supplierId: Number(v.supplierId), warehouseId: Number(v.warehouseId), expectedAt: v.expectedAt || undefined, note: v.note || undefined,
      items: lines.map((l) => ({ variantId: l.row.variantId, quantity: Number(l.qty), unitCost: l.cost })),
    } }),
    onSuccess: onDone,
  });
  const total = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.cost || 0), 0);
  const valid = v.supplierId && v.warehouseId && lines.length && lines.every((l) => Number(l.qty) > 0 && /^\d+(\.\d{1,2})?$/.test(l.cost));
  return (
    <Dialog open onClose={onClose} label="New purchase order" className="max-w-3xl">
      <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2 className="text-xl font-extrabold">New purchase order</h2>
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Supplier" value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })}><option value="">Choose…</option>{suppliers.data?.filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          <Select label="Deliver to" value={v.warehouseId} onChange={(e) => setV({ ...v, warehouseId: e.target.value })}><option value="">Choose…</option>{whs.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
          <label className="text-xs font-semibold uppercase tracking-[0.1em]">Expected<input type="date" value={v.expectedAt} onChange={(e) => setV({ ...v, expectedAt: e.target.value })} className="mt-1.5 block h-11 w-full rounded-sm border border-line px-2 text-sm normal-case tracking-normal" /></label>
        </div>
        <VariantSearch exclude={lines.map((l) => l.row.variantId)} onPick={(row) => setLines([...lines, { row, qty: '10', cost: row.warehouses[0]?.averageCost && Number(row.warehouses[0].averageCost) > 0 ? row.warehouses[0].averageCost : '' }])} />
        {lines.length > 0 && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted"><th className="pb-1">Variant</th><th className="pb-1">Qty</th><th className="pb-1">Unit cost (GH₵)</th><th className="pb-1 text-right">Line</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.row.variantId} className="border-t border-line">
                  <td className="py-2">{l.row.product.name}<span className="block font-mono text-xs text-muted">{l.row.sku}</span></td>
                  <td className="py-2"><input value={l.qty} inputMode="numeric" aria-label="Quantity" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/\D/g, '') } : x)))} className="h-9 w-20 rounded-sm border border-line px-2" /></td>
                  <td className="py-2"><input value={l.cost} inputMode="decimal" aria-label="Unit cost" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} className="h-9 w-28 rounded-sm border border-line px-2" /></td>
                  <td className="py-2 text-right">{formatMoney(Number(l.qty || 0) * Number(l.cost || 0))}</td>
                  <td className="py-2 pl-2"><button type="button" className="text-xs font-semibold text-danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              ))}
              <tr className="border-t border-ink font-bold"><td colSpan={3} className="py-2">Total</td><td className="py-2 text-right">{formatMoney(total)}</td><td /></tr>
            </tbody>
          </table>
        )}
        <input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Note to supplier (optional)" className="h-10 w-full rounded-sm border border-line px-3 text-sm" />
        <div className="flex gap-2"><Button type="submit" loading={save.isPending} disabled={!valid}>Save draft</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}
