'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { Dialog } from '@/components/dialog';
import { Stars } from '@/components/product-card';
import { Alert, Badge, Button, Field, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/shop';

interface Reviewable { orderItemId: number; name: string; variantLabel: string | null; image: string | null; slug: string; orderNumber: string; deliveredAt: string | null }
interface MyReview { id: number; rating: number; title: string | null; body: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; createdAt: string; product: { name: string; slug: string } }
const STATUS = { PENDING: ['neutral', 'Awaiting moderation'], APPROVED: ['success', 'Published'], REJECTED: ['danger', 'Not published'] } as const;

export default function ReviewsPage() {
  const todo = useQuery({ queryKey: ['reviewable'], queryFn: () => api<Reviewable[]>('/me/reviewable') });
  const mine = useQuery({ queryKey: ['my-reviews'], queryFn: () => api<MyReview[]>('/me/reviews') });
  const [writing, setWriting] = useState<Reviewable | null>(null);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-extrabold">Reviews</h1>
        <p className="mt-1 text-sm text-muted">Help other shoppers with size and quality. Each published review earns you bonus points.</p>
      </div>
      <section>
        <h2 className="mb-3 text-lg font-extrabold">Waiting for your review</h2>
        {todo.isPending ? <Skeleton className="h-24" /> : todo.isError ? <Alert tone="danger">{errorMessage(todo.error)}</Alert> : !todo.data.length ? (
          <p className="text-sm text-muted">Nothing to review right now. Items appear here once they’re delivered.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {todo.data.map((r) => (
              <li key={r.orderItemId} className="flex items-center gap-4 rounded-sm border border-line bg-paper p-3">
                <span className="relative h-20 w-16 shrink-0 overflow-hidden rounded-sm bg-sand">{r.image && <Image src={r.image} alt="" fill sizes="64px" className="object-cover" />}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <Link href={`/p/${r.slug}`} className="line-clamp-2 font-medium hover:underline">{r.name}</Link>
                  <span className="block text-xs text-muted">{r.variantLabel} · {r.orderNumber}</span>
                </span>
                <Button size="sm" onClick={() => setWriting(r)}>Review</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-extrabold">Your reviews</h2>
        {mine.isPending ? <Skeleton className="h-24" /> : !mine.data?.length ? <p className="text-sm text-muted">You haven’t written any reviews yet.</p> : (
          <ul className="divide-y divide-line rounded-sm border border-line bg-paper">
            {mine.data.map((r) => (
              <li key={r.id} className="p-4 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <Stars rating={r.rating} />
                  <Link href={`/p/${r.product.slug}`} className="font-semibold hover:underline">{r.product.name}</Link>
                  <Badge tone={STATUS[r.status][0]} className="ml-auto">{STATUS[r.status][1]}</Badge>
                </div>
                {r.title && <p className="mt-2 font-medium">{r.title}</p>}
                {r.body && <p className="mt-1 text-muted">{r.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {writing && <ReviewDialog item={writing} onClose={() => setWriting(null)} />}
    </div>
  );
}

const FITS = [['RUNS_SMALL', 'Runs small'], ['TRUE_TO_SIZE', 'True to size'], ['RUNS_LARGE', 'Runs large']] as const;

function ReviewDialog({ item, onClose }: { item: Reviewable; onClose: () => void }) {
  const qc = useQueryClient();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [fit, setFit] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api('/me/reviews', { method: 'POST', body: { orderItemId: item.orderItemId, rating, title: title || undefined, body: body || undefined, fit: fit ?? undefined } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reviewable'] }); qc.invalidateQueries({ queryKey: ['my-reviews'] }); onClose(); },
  });
  const errs = m.error instanceof ApiError ? m.error.fieldErrors : {};
  return (
    <Dialog open onClose={onClose} label={`Review ${item.name}`} className="max-w-lg">
      <form className="space-y-5 p-6" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div>
          <h2 className="text-xl font-extrabold">Review {item.name}</h2>
          <p className="text-sm text-muted">{item.variantLabel}</p>
        </div>
        {m.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.1em]">Your rating</legend>
          <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)} onMouseEnter={() => setHover(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-pressed={rating === n}
                className={cx('text-3xl leading-none', (hover || rating) >= n ? 'text-ink' : 'text-line')}>★</button>
            ))}
          </div>
          {errs.rating && <p role="alert" className="mt-1 text-[13px] text-danger">{errs.rating}</p>}
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.1em]">How does it fit? (optional)</legend>
          <div className="flex flex-wrap gap-2">
            {FITS.map(([v, l]) => (
              <button key={v} type="button" aria-pressed={fit === v} onClick={() => setFit(fit === v ? null : v)}
                className={cx('rounded-full border px-3 py-1.5 text-sm', fit === v ? 'border-ink bg-ink text-paper' : 'border-line hover:border-ink')}>{l}</button>
            ))}
          </div>
        </fieldset>
        <Field label="Headline (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} error={errs.title} />
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.1em]">Your review (optional)</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={3000} className="mt-1.5 w-full rounded-sm border border-line p-3 text-sm" placeholder="Fabric, fit, colour, how you wore it…" />
          {errs.body && <span role="alert" className="text-[13px] text-danger">{errs.body}</span>}
        </label>
        <div className="flex gap-2">
          <Button type="submit" loading={m.isPending} disabled={!rating}>Submit review</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
        <p className="text-xs text-muted">Reviews are checked before they’re published.</p>
      </form>
    </Dialog>
  );
}
