'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { FilterSelect, Forbidden, PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { PAYOUT_METHOD } from '@/components/settlement-view';
import { Alert, Button } from '@/components/ui';
import { api, apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface Payable { vendorId: number; vendor: string; vendorStatus: string; payoutMethod: string | null; lines: number; gross: string; commission: string; net: string; oldest: string }
interface SettlementRow {
  id: number; reference: string; status: string; periodStart: string; periodEnd: string; grossAmount: string; commissionAmount: string; netAmount: string;
  createdAt: string; paidAt: string | null; lines: number; vendor: { id: number; businessName: string; payoutMethod: string | null };
}
const d = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function SettlementsInner() {
  const f = useUrlFilters();
  const qc = useQueryClient();
  const can = useCan('settlements.manage');
  const query = { q: f.get('q'), status: f.get('status'), vendorId: f.get('vendorId'), page: f.get('page') || 1, pageSize: 25 };
  const payable = useQuery({ queryKey: ['admin-payable'], queryFn: () => api<Payable[]>('/admin/settlements/payable'), enabled: can });
  const list = useQuery({ queryKey: ['admin-settlements', query], queryFn: () => apiWithMeta<SettlementRow[]>(`/admin/settlements${qs(query)}`), placeholderData: (p) => p, enabled: can });
  const generate = useMutation({
    mutationFn: (vendorId?: number) => api<{ created: string[] }>('/admin/settlements/generate', { method: 'POST', body: vendorId ? { vendorId } : {} }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-payable'] }); qc.invalidateQueries({ queryKey: ['admin-settlements'] }); },
  });
  if (!can) return <Forbidden />;
  const totalNet = (payable.data ?? []).reduce((s, p) => s + Number(p.net), 0);

  return (
    <>
      <PageHeader title="Settlements" description="Vendor earnings become payable once an order is delivered and its return window has closed. Bundle them into statements, approve, pay, then record the transfer reference." />
      {generate.isSuccess && <div className="mb-4"><Alert tone="success">{generate.data.created.length ? `Created ${generate.data.created.join(', ')}.` : 'Nothing new to settle.'}</Alert></div>}
      {generate.isError && <div className="mb-4"><Alert tone="danger">{errorMessage(generate.error)}</Alert></div>}
      <Panel className="mb-6" padded={false} title={`Ready to settle${payable.data?.length ? ` · ${formatMoney(totalNet)}` : ''}`}
        actions={!!payable.data?.length && <Button size="sm" loading={generate.isPending && generate.variables === undefined} onClick={() => generate.mutate(undefined)}>Generate all statements</Button>}>
        <QueryState q={payable} empty={!payable.data?.length} emptyText="No payable earnings right now." rows={2}>
          <Table head={['Vendor', 'Sales lines', 'Since', 'Sales', 'Commission', 'Payout', 'Payout method', '']}>
            {payable.data?.map((p) => (
              <tr key={p.vendorId}>
                <Td><Link href={`/admin/vendors/${p.vendorId}`} className="font-medium hover:underline">{p.vendor}</Link>{p.vendorStatus !== 'ACTIVE' && <span className="ml-2"><StatusPill status={p.vendorStatus} /></span>}</Td>
                <Td>{p.lines}</Td>
                <Td className="text-muted">{d(p.oldest)}</Td>
                <Td>{formatMoney(p.gross)}</Td>
                <Td className="text-muted">{formatMoney(p.commission)}</Td>
                <Td className="font-semibold">{formatMoney(p.net)}</Td>
                <Td>{p.payoutMethod ? PAYOUT_METHOD[p.payoutMethod] : <span className="text-danger">Not set</span>}</Td>
                <Td><Button size="sm" variant="secondary" loading={generate.isPending && generate.variables === p.vendorId} onClick={() => generate.mutate(p.vendorId)}>Generate</Button></Td>
              </tr>
            ))}
          </Table>
        </QueryState>
      </Panel>

      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Reference or vendor" />
        <FilterSelect label="Status" value={f.get('status')} onChange={(v) => f.set('status', v)} options={[['', 'All statuses'], ['DRAFT', 'Draft'], ['APPROVED', 'Approved'], ['PAID', 'Paid']]} />
        {f.get('vendorId') && <Button variant="ghost" size="sm" className="h-10" onClick={() => f.set('vendorId', '')}>Clear vendor filter ×</Button>}
      </div>
      <Panel padded={false} title="Statements">
        <QueryState q={list} empty={!list.data?.data.length} emptyText="No statements match.">
          <Table head={['Reference', 'Vendor', 'Period', 'Lines', 'Sales', 'Commission', 'Payout', 'Status']}>
            {list.data?.data.map((s) => (
              <tr key={s.id} className="hover:bg-ivory">
                <Td><Link href={`/admin/settlements/${s.id}`} className="font-semibold hover:underline">{s.reference}</Link></Td>
                <Td>{s.vendor.businessName}</Td>
                <Td className="whitespace-nowrap text-muted">{d(s.periodStart)} – {d(s.periodEnd)}</Td>
                <Td>{s.lines}</Td>
                <Td>{formatMoney(s.grossAmount)}</Td>
                <Td className="text-muted">{formatMoney(s.commissionAmount)}</Td>
                <Td className="font-semibold">{formatMoney(s.netAmount)}</Td>
                <Td><StatusPill status={s.status} /></Td>
              </tr>
            ))}
          </Table>
          <Pager meta={list.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function SettlementsPage() {
  return <Suspense><SettlementsInner /></Suspense>;
}
