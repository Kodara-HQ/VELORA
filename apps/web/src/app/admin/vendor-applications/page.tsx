'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { FilterSelect, Forbidden, PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';
import { useCan } from '@/lib/session';
import type { VendorApplication } from '@/components/admin/types';

function ApplicationsInner() {
  const f = useUrlFilters();
  const can = useCan('vendors.view');
  const query = { q: f.get('q'), status: f.get('status'), page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['admin-vendor-applications', query], queryFn: () => apiWithMeta<VendorApplication[]>(`/admin/vendor-applications${qs(query)}`), placeholderData: (p) => p, enabled: can });
  if (!can) return <Forbidden />;
  return (
    <>
      <PageHeader title="Vendor applications" description="Businesses applying to sell on VÉLORA Marketplace." />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Business name or email" />
        <FilterSelect label="Status" value={f.get('status')} onChange={(v) => f.set('status', v)}
          options={[['', 'All statuses'], ['SUBMITTED', 'New'], ['UNDER_REVIEW', 'Under review'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']]} />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No applications match.">
          <Table head={['Business', 'Applicant', 'Categories', 'Submitted', 'Status']}>
            {q.data?.data.map((a) => (
              <tr key={a.id} className="hover:bg-ivory">
                <Td><Link href={`/admin/vendor-applications/${a.id}`} className="font-semibold hover:underline">{a.businessName}</Link></Td>
                <Td>{a.user.firstName} {a.user.lastName}<span className="block text-xs text-muted">{a.user.email}</span></Td>
                <Td className="text-muted">{(a.productCategories ?? []).join(', ')}</Td>
                <Td className="whitespace-nowrap text-muted">{new Date(a.createdAt).toLocaleDateString('en-GB')}</Td>
                <Td><StatusPill status={a.status === 'SUBMITTED' ? 'PENDING' : a.status} /></Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function VendorApplicationsPage() {
  return <Suspense><ApplicationsInner /></Suspense>;
}
