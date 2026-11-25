'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { Dialog } from '@/components/dialog';
import { Alert, Button, Field } from '@/components/ui';
import { api, apiWithMeta, ApiError } from '@/lib/api';
import { qs } from '@/lib/admin';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface StockRow {
  variantId: number; sku: string; label: string; isActive: boolean; product: { id: number; name: string; status: string };
  onHand: number; reserved: number; available: number; locations: Array<{ warehouse: string; own: boolean; onHand: number; reserved: number }>;
}

function InventoryInner() {
  const f = useUrlFilters();
  const canAdjust = useCan('vendor_portal.products');
  const [editing, setEditing] = useState<StockRow | null>(null);
  const query = { q: f.get('q'), page: f.get('page') || 1, pageSize: 50 };
  const q = useQuery({ queryKey: ['vendor-stock', query], queryFn: () => apiWithMeta<StockRow[]>(`/vendor/inventory${qs(query)}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Inventory" description="Stock at your location. Customers can only buy what’s available (on hand minus reserved for open orders)." />
      <div className="mb-4"><SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Search product or SKU" /></div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No variants yet. Add a product first.">
          <Table head={['Product', 'SKU', 'Variant', 'On hand', 'Reserved', 'Available', 'Locations', '']}>
            {q.data?.data.map((r) => (
              <tr key={r.variantId} className={r.isActive ? undefined : 'opacity-50'}>
                <Td><Link href={`/vendor/products/${r.product.id}`} className="font-medium hover:underline">{r.product.name}</Link> <span className="ml-1"><StatusPill status={r.product.status} /></span></Td>
                <Td className="font-mono text-xs">{r.sku}</Td>
                <Td>{r.label || '—'}</Td>
                <Td>{r.onHand}</Td>
                <Td>{r.reserved}</Td>
                <Td className={r.available <= 0 ? 'font-semibold text-danger' : r.available <= 3 ? 'font-semibold text-rose-deep' : 'font-semibold'}>{r.available}</Td>
                <Td className="text-xs text-muted">{r.locations.map((l) => `${l.own ? 'Yours' : l.warehouse}: ${l.onHand}`).join(' · ') || '—'}</Td>
                <Td>{canAdjust && <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>Adjust</Button>}</Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
      {editing && <AdjustDialog row={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function AdjustDialog({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api('/vendor/inventory/adjust', { method: 'POST', body: { variantId: row.variantId, delta: Number(delta), note } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vendor-stock'] }); onClose(); },
  });
  const errs = m.error instanceof ApiError ? m.error.fieldErrors : {};
  const n = Number(delta);
  const own = row.locations.find((l) => l.own);
  return (
    <Dialog open onClose={onClose} label="Adjust stock" className="max-w-md">
      <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div>
          <h2 className="text-xl font-extrabold">Adjust stock</h2>
          <p className="mt-1 text-sm text-muted">{row.product.name} · {row.label} · <span className="font-mono">{row.sku}</span></p>
        </div>
        {m.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
        <Field label="Change (+ to add, − to remove)" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, ''))} placeholder="e.g. 10 or -2" error={errs.delta}
          hint={Number.isInteger(n) && n !== 0 ? `Your location: ${own?.onHand ?? 0} → ${(own?.onHand ?? 0) + n}` : undefined} />
        <Field label="Reason" value={note} onChange={(e) => setNote(e.target.value)} placeholder="New stock from workshop" error={errs.note} />
        <div className="flex gap-2">
          <Button type="submit" loading={m.isPending} disabled={!Number.isInteger(n) || n === 0 || note.trim().length < 3}>Save adjustment</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function VendorInventoryPage() {
  return <Suspense><InventoryInner /></Suspense>;
}
