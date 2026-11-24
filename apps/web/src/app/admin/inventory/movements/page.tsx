'use client';

import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { useWarehouses } from '@/components/admin/inventory-shared';
import { FilterSelect, humanize, PageHeader, Pager, Panel, QueryState, SearchInput, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';

interface Movement { id: number; type: string; quantity: number; balanceAfter: number; unitCost: string | null; referenceType: string | null; referenceId: number | null; note: string | null; createdAt: string; warehouse: string; sku: string; product: string; label: string; by: string }
const TYPES = ['OPENING_BALANCE', 'PURCHASE_RECEIPT', 'SALE', 'RESERVATION', 'RESERVATION_RELEASE', 'CUSTOMER_RETURN', 'ADJUSTMENT', 'DAMAGE', 'TRANSFER_OUT', 'TRANSFER_IN'];

function Inner() {
  const f = useUrlFilters();
  const whs = useWarehouses();
  const query = { q: f.get('q'), type: f.get('type'), warehouseId: f.get('warehouseId'), page: f.get('page') || 1, pageSize: 50 };
  const q = useQuery({ queryKey: ['admin-movements', query], queryFn: () => apiWithMeta<Movement[]>(`/admin/stock-movements${qs(query)}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Stock movements" description="Append-only ledger of every change to stock. Reservations hold stock without changing on-hand." />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Search SKU or product" />
        <FilterSelect label="Type" value={f.get('type')} onChange={(v) => f.set('type', v)} options={[['', 'All types'], ...TYPES.map((t) => [t, humanize(t)] as [string, string])]} />
        <FilterSelect label="Warehouse" value={f.get('warehouseId')} onChange={(v) => f.set('warehouseId', v)} options={[['', 'All warehouses'], ...(whs.data ?? []).map((w) => [String(w.id), w.name] as [string, string])]} />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No movements match.">
          <Table head={['When', 'Product / SKU', 'Warehouse', 'Type', 'Change', 'On hand after', 'Reference', 'By']}>
            {q.data?.data.map((m) => (
              <tr key={m.id}>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(m.createdAt)}</Td>
                <Td>{m.product}<span className="block font-mono text-xs text-muted">{m.sku} · {m.label}</span></Td>
                <Td>{m.warehouse}</Td>
                <Td>{humanize(m.type)}</Td>
                <Td className={m.type.startsWith('RESERVATION') ? 'text-muted' : m.quantity < 0 ? 'font-semibold text-danger' : 'font-semibold text-success'}>
                  {m.quantity > 0 ? '+' : ''}{m.quantity}{m.type.startsWith('RESERVATION') && <span className="block text-[10px]">reserved</span>}
                </Td>
                <Td>{m.balanceAfter}</Td>
                <Td className="text-xs text-muted">{m.referenceType ? `${humanize(m.referenceType)} #${m.referenceId ?? ''}` : '—'}{m.note && <span className="block">{m.note}</span>}</Td>
                <Td className="text-muted">{m.by}</Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function MovementsPage() {
  return <Suspense><Inner /></Suspense>;
}
