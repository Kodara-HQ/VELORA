'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { FilterSelect, PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { ButtonLink } from '@/components/ui';
import { apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Row {
  id: number; name: string; slug: string; styleCode: string; status: string; price: string; soldCount: number;
  category: string; image: string | null; variantCount: number; available: number; updatedAt: string;
}

function ProductsInner() {
  const f = useUrlFilters();
  const canManage = useCan('vendor_portal.products');
  const query = { q: f.get('q'), status: f.get('status'), sort: 'updated', page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['vendor-products', query], queryFn: () => apiWithMeta<Row[]>(`/vendor/products${qs(query)}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Products" description="Everything you list is reviewed by VÉLORA before it goes on sale."
        actions={canManage && <ButtonLink href="/vendor/products/new">Add product</ButtonLink>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Search name, style code or SKU" />
        <FilterSelect label="Status" value={f.get('status')} onChange={(v) => f.set('status', v)}
          options={[['', 'All statuses'], ['ACTIVE', 'Live'], ['PENDING_REVIEW', 'In review'], ['DRAFT', 'Draft'], ['REJECTED', 'Rejected'], ['ARCHIVED', 'Archived']]} />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText={f.get('q') || f.get('status') ? 'No products match.' : 'No products yet. Add your first piece to get started.'}>
          <Table head={['Product', 'Status', 'Price', 'Variants', 'Available', 'Sold', 'Updated']}>
            {q.data?.data.map((p) => (
              <tr key={p.id} className="hover:bg-ivory">
                <Td>
                  <Link href={`/vendor/products/${p.id}`} className="flex items-center gap-3">
                    <span className="h-14 w-11 shrink-0 overflow-hidden rounded-sm bg-sand">{p.image && <img src={p.image} alt="" className="h-full w-full object-cover" />}</span>
                    <span className="min-w-0"><span className="block font-medium hover:underline">{p.name}</span><span className="text-xs text-muted">{p.styleCode} · {p.category}</span></span>
                  </Link>
                </Td>
                <Td><StatusPill status={p.status} /></Td>
                <Td>{formatMoney(p.price)}</Td>
                <Td>{p.variantCount}</Td>
                <Td className={p.available <= 0 ? 'font-semibold text-danger' : undefined}>{p.available}</Td>
                <Td>{p.soldCount}</Td>
                <Td className="whitespace-nowrap text-muted">{new Date(p.updatedAt).toLocaleDateString('en-GB')}</Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function VendorProductsPage() {
  return <Suspense><ProductsInner /></Suspense>;
}
