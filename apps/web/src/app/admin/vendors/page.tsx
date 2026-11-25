'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { FilterSelect, Forbidden, PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import type { VendorStats } from '@/components/admin/types';

interface VendorRow {
  id: number; businessName: string; slug: string; email: string; status: string; commissionRate: string; verifiedAt: string | null; createdAt: string;
  owner: { firstName: string; lastName: string; email: string }; stats90d: VendorStats;
}

function VendorsInner() {
  const f = useUrlFilters();
  const can = useCan('vendors.view');
  const query = { q: f.get('q'), status: f.get('status'), page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['admin-vendors', query], queryFn: () => apiWithMeta<VendorRow[]>(`/admin/vendors${qs(query)}`), placeholderData: (p) => p, enabled: can });
  if (!can) return <Forbidden />;
  return (
    <>
      <PageHeader title="Vendors" description="Marketplace sellers. Sales and returns cover the last 90 days." />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Shop name or email" />
        <FilterSelect label="Status" value={f.get('status')} onChange={(v) => f.set('status', v)} options={[['', 'All statuses'], ['ACTIVE', 'Active'], ['SUSPENDED', 'Suspended']]} />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No vendors match.">
          <Table head={['Shop', 'Owner', 'Status', 'Commission', 'Live products', 'Sales (90d)', 'Returns', 'Rating', 'Payable']}>
            {q.data?.data.map((v) => (
              <tr key={v.id} className="hover:bg-ivory">
                <Td><Link href={`/admin/vendors/${v.id}`} className="font-semibold hover:underline">{v.businessName}</Link><span className="block text-xs text-muted">/v/{v.slug}</span></Td>
                <Td>{v.owner.firstName} {v.owner.lastName}<span className="block text-xs text-muted">{v.owner.email}</span></Td>
                <Td><StatusPill status={v.status} /></Td>
                <Td>{v.commissionRate}%</Td>
                <Td>{v.stats90d.products.active}{v.stats90d.products.pendingReview > 0 && <span className="text-xs text-rose-deep"> +{v.stats90d.products.pendingReview} in review</span>}</Td>
                <Td>{formatMoney(v.stats90d.grossSales)}<span className="block text-xs text-muted">{v.stats90d.orders} orders</span></Td>
                <Td>{v.stats90d.returnRate}%</Td>
                <Td>{v.stats90d.reviewCount ? `★ ${v.stats90d.rating.toFixed(1)}` : '—'}</Td>
                <Td className="font-semibold">{formatMoney(v.stats90d.earnings.payable)}</Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function VendorsPage() {
  return <Suspense><VendorsInner /></Suspense>;
}
