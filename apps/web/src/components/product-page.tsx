'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { Fragment, useState, type MouseEvent } from 'react';
import { apiWithMeta } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { ProductDetail, Review } from '@/lib/types';
import { ChevronIcon, ReturnIcon, ShieldIcon, TruckIcon } from './icons';
import { Stars } from './product-card';
import { Badge, Button, cx } from './ui';
import { VariantPicker } from './variant-picker';

/** Gallery + buy box. Picking a colour swaps the gallery to that colourway's images. */
export function ProductHero({ product }: { product: ProductDetail }) {
  const [color, setColor] = useState<string | null>(product.variants.find((v) => v.available > 0)?.color ?? product.variants[0]?.color ?? null);
  const forColor = product.images.filter((i) => i.color === color);
  const images = forColor.length ? forColor : product.images;
  const [index, setIndex] = useState(0);
  const current = images[Math.min(index, images.length - 1)];
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        {images.length > 1 && (
          <ul className="flex gap-2 overflow-x-auto sm:w-20 sm:flex-col" aria-label="Product images">
            {images.map((img, i) => (
              <li key={img.id} className="shrink-0">
                <button type="button" onClick={() => setIndex(i)} aria-label={`Show image ${i + 1}`} aria-current={i === index}
                  className={cx('relative block h-24 w-[72px] overflow-hidden rounded-sm border-2 bg-sand sm:h-[104px] sm:w-20', i === index ? 'border-ink' : 'border-transparent')}>
                  <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div
          className="relative aspect-[3/4] flex-1 cursor-zoom-in overflow-hidden rounded-sm bg-sand"
          onMouseMove={onMove} onMouseLeave={() => setZoom(null)}
        >
          {current && (
            <Image src={current.url} alt={current.alt} fill priority sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover transition-transform duration-200"
              style={zoom ? { transform: 'scale(1.9)', transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined} />
          )}
          {images.length > 1 && (
            <div className="absolute inset-x-3 bottom-3 flex justify-between sm:hidden">
              <button type="button" aria-label="Previous image" onClick={() => setIndex((index - 1 + images.length) % images.length)} className="flex h-10 w-10 items-center justify-center rounded-full bg-paper/90"><ChevronIcon dir="left" /></button>
              <button type="button" aria-label="Next image" onClick={() => setIndex((index + 1) % images.length)} className="flex h-10 w-10 items-center justify-center rounded-full bg-paper/90"><ChevronIcon /></button>
            </div>
          )}
        </div>
      </div>

      <div className="lg:sticky lg:top-40 lg:self-start">
        {product.brand && <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{product.brand.name}</p>}
        <h1 className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">{product.name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
          {product.reviewCount > 0 && (
            <a href="#reviews" className="flex items-center gap-2 hover:text-ink"><Stars rating={product.rating} /> {product.rating.toFixed(1)} · {product.reviewCount} reviews</a>
          )}
          <span>Style {product.styleCode}</span>
          {product.vendor && <a href={`/v/${product.vendor.slug}`} className="hover:text-ink"><Badge tone="outline">Sold by {product.vendor.name}</Badge></a>}
        </div>
        {product.shortDescription && <p className="mt-5 leading-relaxed text-muted">{product.shortDescription}</p>}
        <div className="mt-6">
          <VariantPicker product={product} onColorChange={(c) => { setColor(c); setIndex(0); }} />
        </div>
        <ul className="mt-8 space-y-3 border-t border-line pt-6 text-sm">
          {product.delivery.map((d) => (
            <li key={d.zone} className="flex gap-3">
              <TruckIcon className="mt-0.5 shrink-0 text-rose-deep" width={18} height={18} />
              <span>
                <b>{d.zone}:</b> {d.minDays === d.maxDays ? `${d.maxDays} day${d.maxDays === 1 ? '' : 's'}` : `${d.minDays}–${d.maxDays} days`} · {formatMoney(d.fee)}
                {d.freeOver && <span className="text-muted"> (free over {formatMoney(d.freeOver)})</span>}
              </span>
            </li>
          ))}
          <li className="flex gap-3"><ShieldIcon className="shrink-0 text-rose-deep" width={18} height={18} /> Pay cash or MoMo when your order arrives</li>
          <li className="flex gap-3"><ReturnIcon className="shrink-0 text-rose-deep" width={18} height={18} /> 14-day returns and size exchanges</li>
        </ul>
      </div>
    </div>
  );
}

export function ProductDetails({ product }: { product: ProductDetail }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      <Accordion title="Description" defaultOpen>
        <p className="leading-relaxed">{product.description}</p>
      </Accordion>
      <Accordion title="Details & materials">
        <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
          {product.material && <><dt className="text-muted">Material</dt><dd>{product.material}</dd></>}
          {product.attributes.filter((a) => a.name !== 'Material').map((a) => (
            <Fragment key={a.name}><dt className="text-muted">{a.name}</dt><dd>{a.value}</dd></Fragment>
          ))}
          <dt className="text-muted">Style code</dt><dd>{product.styleCode}</dd>
        </dl>
      </Accordion>
      {product.careInstructions && <Accordion title="Care"><p>{product.careInstructions}</p></Accordion>}
      {product.questions.length > 0 && (
        <Accordion title={`Questions & answers (${product.questions.length})`}>
          <ul className="space-y-5">
            {product.questions.map((q) => (
              <li key={q.id}>
                <p className="font-semibold">Q: {q.question}</p>
                <p className="mt-1 text-muted">A: {q.answer}</p>
              </li>
            ))}
          </ul>
        </Accordion>
      )}
    </div>
  );
}

function Accordion({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group py-5">
      <summary className="flex cursor-pointer list-none items-center justify-between font-display text-lg font-bold">
        {title}<span className="text-2xl font-normal leading-none text-muted transition group-open:rotate-45">+</span>
      </summary>
      <div className="mt-4 text-[15px]">{children}</div>
    </details>
  );
}

const FIT_LABEL = { RUNS_SMALL: 'Runs small', TRUE_TO_SIZE: 'True to size', RUNS_LARGE: 'Runs large' } as const;

export function Reviews({ product }: { product: ProductDetail }) {
  const [rating, setRating] = useState<number | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['reviews', product.slug, rating],
    queryFn: ({ pageParam }) => apiWithMeta<Review[]>(`/products/${product.slug}/reviews?page=${pageParam}&pageSize=5${rating ? `&rating=${rating}` : ''}`, { auth: false }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta && last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });
  const reviews = q.data?.pages.flatMap((p) => p.data) ?? [];
  const { reviewSummary: s } = product;
  const fits = reviews.filter((r) => r.fit);
  const fitTrue = fits.length ? Math.round((fits.filter((r) => r.fit === 'TRUE_TO_SIZE').length / fits.length) * 100) : null;

  return (
    <section id="reviews" aria-labelledby="reviews-h" className="scroll-mt-40 py-12">
      <h2 id="reviews-h" className="text-2xl font-extrabold sm:text-3xl">Reviews</h2>
      {s.total === 0 ? (
        <p className="mt-4 text-muted">No reviews yet. Customers who buy this piece can review it after delivery.</p>
      ) : (
        <div className="mt-6 grid gap-10 lg:grid-cols-[300px_1fr]">
          <div>
            <p className="font-display text-5xl font-extrabold">{s.average.toFixed(1)}</p>
            <Stars rating={s.average} size={18} className="mt-2" />
            <p className="mt-1 text-sm text-muted">{s.total} review{s.total === 1 ? '' : 's'}</p>
            <ul className="mt-5 space-y-1.5">
              {s.distribution.map((d) => (
                <li key={d.rating}>
                  <button type="button" disabled={!d.count} onClick={() => setRating(rating === d.rating ? null : d.rating)} aria-pressed={rating === d.rating}
                    className={cx('flex w-full items-center gap-3 rounded-sm px-1 py-0.5 text-sm disabled:opacity-40', rating === d.rating && 'bg-sand')}>
                    <span className="w-8">{d.rating}★</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-sand"><span className="block h-full bg-ink" style={{ width: `${s.total ? (d.count / s.total) * 100 : 0}%` }} /></span>
                    <span className="w-6 text-right text-muted">{d.count}</span>
                  </button>
                </li>
              ))}
            </ul>
            {fitTrue != null && <p className="mt-5 text-sm"><b>{fitTrue}%</b> say it fits true to size</p>}
          </div>
          <div>
            {rating && <p className="mb-4 text-sm">Showing {rating}★ reviews · <button type="button" className="underline" onClick={() => setRating(null)}>Show all</button></p>}
            <ul className="divide-y divide-line">
              {reviews.map((r) => (
                <li key={r.id} className="py-5 first:pt-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <Stars rating={r.rating} />
                    {r.title && <p className="font-semibold">{r.title}</p>}
                  </div>
                  {r.body && <p className="mt-2 leading-relaxed text-muted">{r.body}</p>}
                  <p className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
                    <span className="font-medium text-ink">{r.author}</span>
                    {r.isVerifiedBuyer && <Badge tone="success">Verified buyer</Badge>}
                    {r.fit && <span>Fit: {FIT_LABEL[r.fit]}</span>}
                    <span>{new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </p>
                </li>
              ))}
            </ul>
            {q.hasNextPage && <Button variant="secondary" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>More reviews</Button>}
          </div>
        </div>
      )}
    </section>
  );
}
