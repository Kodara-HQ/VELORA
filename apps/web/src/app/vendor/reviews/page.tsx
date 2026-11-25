'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageHeader, Pager, Panel, QueryState } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { Stars } from '@/components/product-card';
import { Badge } from '@/components/ui';
import { apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';

interface Review { id: number; rating: number; title: string | null; body: string | null; fit: string | null; createdAt: string; isVerifiedBuyer: boolean; author: string; product: { id: number; name: string; slug: string } }
const FIT: Record<string, string> = { RUNS_SMALL: 'Runs small', TRUE_TO_SIZE: 'True to size', RUNS_LARGE: 'Runs large' };

function ReviewsInner() {
  const f = useUrlFilters();
  const query = { page: f.get('page') || 1, pageSize: 20 };
  const q = useQuery({ queryKey: ['vendor-reviews', query], queryFn: () => apiWithMeta<Review[]>(`/vendor/reviews${qs(query)}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Reviews" description="Published customer reviews of your products." />
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No reviews yet. Customers can review a product after it’s delivered.">
          <ul className="divide-y divide-line">
            {q.data?.data.map((r) => (
              <li key={r.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Stars rating={r.rating} />
                  {r.title && <p className="font-semibold">{r.title}</p>}
                  <Link href={`/p/${r.product.slug}`} target="_blank" className="ml-auto text-xs text-muted underline">{r.product.name}</Link>
                </div>
                {r.body && <p className="mt-2 text-sm leading-relaxed text-muted">{r.body}</p>}
                <p className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                  <span className="font-medium text-ink">{r.author}</span>
                  {r.isVerifiedBuyer && <Badge tone="success">Verified buyer</Badge>}
                  {r.fit && <span>Fit: {FIT[r.fit] ?? r.fit}</span>}
                  <span>{new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </p>
              </li>
            ))}
          </ul>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function VendorReviewsPage() {
  return <Suspense><ReviewsInner /></Suspense>;
}
