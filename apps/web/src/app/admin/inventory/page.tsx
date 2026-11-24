'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { type StockRow, type StockPage } from '@/components/admin/inventory-shared';
import { FilterSelect, KpiTile, PageHeader, Pager, Panel, QueryState, SearchInput, Select, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { Dialog } from '@/components/dialog';
import { Alert, Badge, Button, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface Valuation { warehouses: Array<{ warehouseId: number; code: string; units: number; skus: number; costValue: string; retailValue: string }>; totals: { units: number; costValue: string; retailValue: string } }

function StockInner() {
  const f = useUrlFilters();
  const canAdjust = useCan('inventory.adjust');
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const query = { q: f.get('q'), warehouseId: f.get('warehouseId'), stock: f.get('stock'), page: f.get('page') || 1 };
  const q = useQuery({ queryKey: ['admin-stock', query], queryFn: () => api<StockPage>(`/admin/inventory${qs(query)}`), placeholderData: (p) => p });
  const val = useQuery({ queryKey: ['admin-valuation'], queryFn: () => api<Valuation>('/admin/inventory/valuation') });
  const whs = q.data?.warehouses ?? [];

  return (
    <>
      <PageHeader title="Stock levels" description="Available = on hand − reserved for customer orders." />
      {val.data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <KpiTile label="Units on hand" value={val.data.totals.units.toLocaleString()} hint={val.data.warehouses.map((w) => `${w.code} ${w.units}`).join(' · ')} />
          <KpiTile label="Stock value at cost" value={formatMoney(val.data.totals.costValue)} hint="Weighted-average cost" />
          <KpiTile label="Stock value at retail" value={formatMoney(val.data.totals.retailValue)} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Search SKU, style code or product" />
        <FilterSelect label="Warehouse" value={f.get('warehouseId')} onChange={(v) => f.set('warehouseId', v)} options={[['', 'All warehouses'], ...whs.map((w) => [String(w.id), w.name] as [string, string])]} />
        <FilterSelect label="Stock" value={f.get('stock')} onChange={(v) => f.set('stock', v)} options={[['', 'All stock'], ['low', 'At or below reorder level'], ['out', 'Out of stock']]} />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.items.length} emptyText="No variants match.">
          <Table head={['Product / SKU', ...whs.filter((w) => !f.get('warehouseId') || String(w.id) === f.get('warehouseId')).map((w) => w.code), 'Reserved', 'Available', 'Reorder at', '']}>
            {q.data?.items.map((r) => (
              <tr key={r.variantId} className="hover:bg-ivory">
                <Td>
                  <Link href={`/admin/products/${r.product.id}`} className="font-medium hover:underline">{r.product.name}</Link>
                  <span className="block font-mono text-xs text-muted">{r.sku} · {r.label}{!r.isActive && ' · inactive'}</span>
                </Td>
                {r.warehouses.map((w) => <Td key={w.warehouseId}>{w.onHand}{w.binLocation && <span className="block text-[10px] text-muted">Bin {w.binLocation}</span>}</Td>)}
                <Td className="text-muted">{r.reserved}</Td>
                <Td>
                  <span className="font-semibold">{r.available}</span>{' '}
                  {r.state === 'out' ? <Badge tone="danger">Out</Badge> : r.state === 'low' ? <Badge tone="rose">Low</Badge> : null}
                </Td>
                <Td className="text-muted">{r.reorderLevel}</Td>
                <Td>{canAdjust && <button type="button" className="text-xs font-semibold underline" onClick={() => setAdjusting(r)}>Adjust</button>}</Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
      {adjusting && <AdjustDialog row={adjusting} warehouses={whs} onClose={() => setAdjusting(null)} />}
    </>
  );
}

function AdjustDialog({ row, warehouses, onClose }: { row: StockRow; warehouses: StockPage['warehouses']; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ warehouseId: String(row.warehouses[0]?.warehouseId ?? ''), mode: 'add', qty: '', type: 'ADJUSTMENT', note: '', reorderLevel: '' });
  const inv = row.warehouses.find((w) => String(w.warehouseId) === v.warehouseId);
  const delta = (v.mode === 'remove' || v.type === 'DAMAGE' ? -1 : 1) * Number(v.qty || 0);
  const adjust = useMutation({
    mutationFn: async () => {
      if (Number(v.qty) > 0) await api('/admin/inventory/adjust', { method: 'POST', body: { variantId: row.variantId, warehouseId: Number(v.warehouseId), delta, type: v.type, note: v.note } });
      if (v.reorderLevel !== '' && inv) await api(`/admin/inventory/${inv.inventoryId}`, { method: 'PATCH', body: { reorderLevel: Number(v.reorderLevel) } });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-stock'] });
      void qc.invalidateQueries({ queryKey: ['admin-valuation'] });
      onClose();
    },
  });
  const errs = adjust.error instanceof ApiError ? adjust.error.fieldErrors : {};
  return (
    <Dialog open onClose={onClose} label="Adjust stock" className="max-w-md">
      <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); adjust.mutate(); }}>
        <div><h2 className="text-xl font-extrabold">Adjust stock</h2><p className="mt-1 text-sm text-muted">{row.product.name} · <span className="font-mono">{row.sku}</span></p></div>
        {adjust.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(adjust.error)}</Alert>}
        <Select label="Warehouse" value={v.warehouseId} onChange={(e) => setV({ ...v, warehouseId: e.target.value })}>
          {row.warehouses.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{warehouses.find((x) => x.id === w.warehouseId)?.name} · {w.onHand} on hand, {w.reserved} reserved</option>)}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Reason" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
            <option value="ADJUSTMENT">Stock count / correction</option>
            <option value="DAMAGE">Damaged / write-off</option>
          </Select>
          {v.type === 'ADJUSTMENT' && (
            <Select label="Direction" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>
              <option value="add">Add units</option><option value="remove">Remove units</option>
            </Select>
          )}
        </div>
        <Field label="Quantity" inputMode="numeric" value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value.replace(/\D/g, '') })}
          hint={inv && v.qty ? `On hand will be ${inv.onHand + delta}` : undefined} error={errs.delta} />
        <Field label="Note (required)" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="e.g. Cycle count 24 Nov" error={errs.note} />
        <Field label="Reorder level (optional)" inputMode="numeric" value={v.reorderLevel} onChange={(e) => setV({ ...v, reorderLevel: e.target.value.replace(/\D/g, '') })} placeholder={String(inv?.reorderLevel ?? '')} />
        <div className="flex gap-2 pt-2">
          <Button type="submit" loading={adjust.isPending} disabled={!Number(v.qty) && v.reorderLevel === ''}>Save</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function InventoryPage() {
  return <Suspense><StockInner /></Suspense>;
}
