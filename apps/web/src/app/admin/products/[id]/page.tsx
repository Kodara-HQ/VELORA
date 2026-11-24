'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ProductForm, type AdminProduct } from '@/components/admin/product-form';
import { PageHeader, QueryState, StatusPill } from '@/components/admin/ui';
import { Dialog } from '@/components/dialog';
import { Alert, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

function EditProduct() {
  const { id } = useParams<{ id: string }>();
  const created = useSearchParams().get('created');
  const router = useRouter();
  const qc = useQueryClient();
  const canDelete = useCan('products.delete');
  const canApprove = useCan('products.approve');
  const canEdit = useCan('products.update');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['admin-product', id], queryFn: () => api<AdminProduct>(`/admin/products/${id}`) });
  const action = useMutation({
    mutationFn: (a: { path: string; method?: 'POST' | 'DELETE'; body?: unknown }) => api<AdminProduct>(`/admin/products/${id}${a.path}`, { method: a.method ?? 'POST', body: a.body ?? {} }),
    onSuccess: (p, a) => {
      if (a.method === 'DELETE') return router.replace('/admin/products');
      qc.setQueryData(['admin-product', id], p);
      setRejecting(false);
    },
  });
  const p = q.data;

  return (
    <>
      <PageHeader
        title={p?.name ?? 'Product'}
        back={{ href: '/admin/products', label: 'Products' }}
        description={p && <span className="flex flex-wrap items-center gap-2"><StatusPill status={p.status} /> {p.styleCode} {p.status === 'ACTIVE' && <Link href={`/p/${p.slug}`} target="_blank" className="underline">View in store ↗</Link>}</span>}
        actions={p && canEdit && <>
          {p.status === 'PENDING_REVIEW' && canApprove && <>
            <Button onClick={() => action.mutate({ path: '/approve' })} loading={action.isPending}>Approve</Button>
            <Button variant="danger" onClick={() => setRejecting(true)}>Reject</Button>
          </>}
          {p.status !== 'ACTIVE' && p.status !== 'PENDING_REVIEW' && <Button onClick={() => action.mutate({ path: '/publish' })} loading={action.isPending}>Publish</Button>}
          {p.status === 'ACTIVE' && <Button variant="secondary" onClick={() => action.mutate({ path: '/archive' })} loading={action.isPending}>Archive</Button>}
          {canDelete && <Button variant="danger" onClick={() => window.confirm(`Delete “${p.name}”? It will disappear from the store and admin lists. Order history is kept.`) && action.mutate({ path: '', method: 'DELETE' })}>Delete</Button>}
        </>}
      />
      {created && <div className="mb-4"><Alert tone="success">Product created. Add images, then publish when it’s ready.</Alert></div>}
      {p?.rejectionReason && p.status === 'REJECTED' && <div className="mb-4"><Alert tone="warning" title="Rejected">{p.rejectionReason}</Alert></div>}
      {action.isError && <div className="mb-4"><Alert tone="danger">{errorMessage(action.error)}</Alert></div>}
      <QueryState q={q}>
        {p && <ProductForm key={`${p.id}-${p.status}`} product={p} onSaved={(np) => qc.setQueryData(['admin-product', id], np)} />}
      </QueryState>
      <Dialog open={rejecting} onClose={() => setRejecting(false)} label="Reject product" className="max-w-md">
        <div className="p-6">
          <h2 className="text-xl font-extrabold">Reject this product</h2>
          <p className="mt-1 text-sm text-muted">The vendor will see your reason.</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-4 w-full rounded-sm border border-line p-3 text-sm" placeholder="e.g. Images are too small; add a size guide" />
          <div className="mt-4 flex gap-2">
            <Button variant="danger" disabled={reason.trim().length < 5} loading={action.isPending} onClick={() => action.mutate({ path: '/reject', body: { reason } })}>Reject</Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

export default function EditProductPage() {
  return <Suspense><EditProduct /></Suspense>;
}
