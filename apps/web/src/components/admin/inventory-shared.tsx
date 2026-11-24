'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { qs } from '@/lib/admin';

export interface StockRow {
  variantId: number; sku: string; label: string; isActive: boolean;
  product: { id: number; name: string; styleCode: string; status: string; image: string | null };
  onHand: number; reserved: number; available: number; reorderLevel: number; state: 'ok' | 'low' | 'out';
  warehouses: Array<{ inventoryId: number; warehouseId: number; onHand: number; reserved: number; available: number; reorderLevel: number; binLocation: string | null; averageCost: string }>;
}
export interface StockPage { items: StockRow[]; meta: { page: number; pageSize: number; total: number; totalPages: number }; warehouses: Array<{ id: number; code: string; name: string; isActive: boolean }> }
export interface Warehouse { id: number; code: string; name: string; address: string | null; city: string | null; region: string | null; phone: string | null; isActive: boolean; isDefault: boolean }

export function useWarehouses() {
  return useQuery({ queryKey: ['admin-warehouses'], queryFn: () => api<Warehouse[]>('/admin/warehouses'), staleTime: 60_000 });
}

/** Type-ahead SKU / product search returning a variant. */
export function VariantSearch({ onPick, exclude = [] }: { onPick: (v: StockRow) => void; exclude?: number[] }) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(term.trim()), 250); return () => clearTimeout(t); }, [term]);
  const q = useQuery({
    queryKey: ['variant-search', debounced],
    queryFn: () => api<StockPage>(`/admin/inventory${qs({ q: debounced, pageSize: 8 })}`),
    enabled: debounced.length >= 2,
  });
  const results = (q.data?.items ?? []).filter((r) => !exclude.includes(r.variantId));
  return (
    <div className="relative">
      <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Add a variant: search SKU or product name"
        aria-label="Search variants" className="h-10 w-full rounded-sm border border-line bg-paper px-3 text-sm focus:border-ink focus:outline-none" />
      {debounced.length >= 2 && (
        <ul className="absolute inset-x-0 top-11 z-10 max-h-64 overflow-y-auto rounded-sm border border-line bg-paper shadow-lg">
          {q.isFetching && !results.length && <li className="px-3 py-2 text-sm text-muted">Searching…</li>}
          {!q.isFetching && !results.length && <li className="px-3 py-2 text-sm text-muted">No variants found.</li>}
          {results.map((r) => (
            <li key={r.variantId}>
              <button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-sand"
                onClick={() => { onPick(r); setTerm(''); setDebounced(''); }}>
                <span className="min-w-0"><span className="block truncate">{r.product.name}</span><span className="font-mono text-xs text-muted">{r.sku} · {r.label}</span></span>
                <span className="shrink-0 text-xs text-muted">{r.available} avail.</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
