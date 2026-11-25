'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ProductForm, type AdminProduct } from '@/components/admin/product-form';
import { PageHeader, QueryState, StatusPill } from '@/components/admin/ui';
import { Alert, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

const STATUS_NOTE: Record<string, string> = {
  PENDING_REVIEW: 'In review. We’ll notify you as soon as it’s approved.',
  DRAFT: 'Draft. Only you can see it. Submit it for review when it’s ready.',
  ACTIVE: 'Live in the store. Saving changes sends it back for a quick review.',
  ARCHIVED: 'Archived. Hidden from the store.',
};

function EditVendorProduct() {
  const { id } = useParams<{ id: string }>();
  const created = useSearchParams().get('created');
  const qc = useQueryClient();
  const canManage = useCan('vendor_portal.products');
  const q = useQuery({ queryKey: ['vendor-product', id], queryFn: () => api<AdminProduct>(`/vendor/products/${id}`) });
  const archive = useMutation({
    mutationFn: () => api<AdminProduct>(`/vendor/products/${id}/archive`, { method: 'POST', body: {} }),
    onSuccess: (p) => qc.setQueryData(['vendor-product', id], p),
  });
  const p = q.data;
  return (
    <>
      <PageHeader title={p?.name ?? 'Product'} back={{ href: '/vendor/products', label: 'Products' }}
        description={p && <span className="flex flex-wrap items-center gap-2"><StatusPill status={p.status} /> {p.styleCode} {p.status === 'ACTIVE' && <Link href={`/p/${p.slug}`} target="_blank" className="underline">View in store ↗</Link>}</span>}
        actions={p && canManage && p.status !== 'ARCHIVED' && (
          <Button variant="secondary" loading={archive.isPending} onClick={() => window.confirm(`Archive “${p.name}”? It will be hidden from the store.`) && archive.mutate()}>Archive</Button>
        )} />
      {created && <div className="mb-4"><Alert tone="success">Product saved.</Alert></div>}
      {p?.status === 'REJECTED' && <div className="mb-4"><Alert tone="warning" title="Not approved">{p.rejectionReason} Make the changes below and submit it again.</Alert></div>}
      {p && STATUS_NOTE[p.status] && <p className="mb-4 text-sm text-muted">{STATUS_NOTE[p.status]}</p>}
      {archive.isError && <div className="mb-4"><Alert tone="danger">{errorMessage(archive.error)}</Alert></div>}
      <QueryState q={q}>
        {p && (canManage
          ? <ProductForm key={`${p.id}-${p.status}`} mode="vendor" product={p} onSaved={(np) => qc.setQueryData(['vendor-product', id], np)} />
          : <Alert tone="info">You can view this product but not edit it.</Alert>)}
      </QueryState>
    </>
  );
}

export default function VendorProductPage() {
  return <Suspense><EditVendorProduct /></Suspense>;
}
