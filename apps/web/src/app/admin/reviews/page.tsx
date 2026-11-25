'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { FilterSelect, Forbidden, PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { Stars } from '@/components/product-card';
import { Alert, Badge, Button } from '@/components/ui';
import { apiWithMeta, api } from '@/lib/api';
import { qs } from '@/lib/admin';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface Review {
  id: number; rating: number; title: string | null; body: string | null; fit: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; isVerifiedBuyer: boolean; createdAt: string;
  user: { id: number; firstName: string; lastName: string; email: string }; product: { id: number; name: string; slug: string };
}
const FIT: Record<string, string> = { RUNS_SMALL: 'Runs small', TRUE_TO_SIZE: 'True to size', RUNS_LARGE: 'Runs large' };

function Inner() {
  const f = useUrlFilters();
  const qc = useQueryClient();
  const can = useCan('reviews.moderate');
  const status = f.get('status') || 'PENDING';
  const query = { status: status === 'ALL' ? '' : status, rating: f.get('rating'), q: f.get('q'), page: f.get('page') || 1, pageSize: 20, order: 'asc' };
  const q = useQuery({ queryKey: ['admin-reviews', query], queryFn: () => apiWithMeta<Review[]>(`/admin/reviews${qs(query)}`), enabled: can, placeholderData: (p) => p });
  const act = useMutation({
    mutationFn: (a: { id: number; approve: boolean; reason?: string }) => api(`/admin/reviews/${a.id}/${a.approve ? 'approve' : 'reject'}`, { method: 'POST', body: a.approve ? {} : { reason: a.reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-reviews'] }),
  });
  if (!can) return <Forbidden />;
  return (
    <>
      <PageHeader title="Reviews" description="Approve reviews to publish them. Verified buyers earn bonus points the first time a review is approved; they’re told when one isn’t published." />
      <div className="mb-4 flex flex-wrap gap-2">
        <FilterSelect label="Status" value={status} onChange={(v) => f.set('status', v)} options={[['PENDING', 'To moderate'], ['APPROVED', 'Published'], ['REJECTED', 'Rejected'], ['ALL', 'All']]} />
        <FilterSelect label="Rating" value={f.get('rating')} onChange={(v) => f.set('rating', v)} options={[['', 'Any rating'], ['5', '5★'], ['4', '4★'], ['3', '3★'], ['2', '2★'], ['1', '1★']]} />
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Product or text" />
      </div>
      {act.isError && <div className="mb-4"><Alert tone="danger">{errorMessage(act.error)}</Alert></div>}
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText={status === 'PENDING' ? 'All caught up. No reviews waiting.' : 'No reviews match.'}>
          <ul className="divide-y divide-line">
            {q.data?.data.map((r) => (
              <li key={r.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_auto]">
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <Stars rating={r.rating} />
                    <Link href={`/admin/products/${r.product.id}`} className="font-semibold hover:underline">{r.product.name}</Link>
                    <StatusPill status={r.status} />
                    {r.isVerifiedBuyer && <Badge tone="success">Verified buyer</Badge>}
                  </div>
                  {r.title && <p className="mt-2 font-medium">{r.title}</p>}
                  {r.body ? <p className="mt-1 whitespace-pre-line text-muted">{r.body}</p> : <p className="mt-1 italic text-muted">Rating only</p>}
                  <p className="mt-2 text-xs text-muted">
                    <Link href={`/admin/customers/${r.user.id}`} className="hover:underline">{r.user.firstName} {r.user.lastName}</Link> · {new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{r.fit && ` · ${FIT[r.fit]}`}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  {r.status !== 'APPROVED' && <Button size="sm" loading={act.isPending && act.variables?.id === r.id && act.variables.approve} onClick={() => act.mutate({ id: r.id, approve: true })}>Approve</Button>}
                  {r.status !== 'REJECTED' && (
                    <Button size="sm" variant="secondary" onClick={() => {
                      const reason = window.prompt('Why isn’t this review being published? (shown to the customer, optional)');
                      if (reason !== null) act.mutate({ id: r.id, approve: false, reason: reason.trim() || undefined });
                    }}>Reject</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function AdminReviewsPage() {
  return <Suspense><Inner /></Suspense>;
}
