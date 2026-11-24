import Link from 'next/link';
import { Suspense } from 'react';
import { serverApi } from '@/lib/server-api';
import type { Facets, ProductCard } from '@/lib/types';
import { ActiveFilters, Filters, SortSelect } from './listing-filters';
import { ProductGrid } from './product-card';
import { ButtonLink, Container, EmptyState } from './ui';
import { cx } from '@/lib/cx';

type Search = Record<string, string | string[] | undefined>;
const PASS = ['sort', 'brand', 'color', 'size', 'minPrice', 'maxPrice', 'inStock', 'onSale', 'minRating', 'page'];

export function toQuery(sp: Search, extra: Record<string, string | undefined> = {}) {
  const p = new URLSearchParams();
  for (const k of PASS) {
    const v = sp[k];
    if (typeof v === 'string' && v) p.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p;
}

/** Server-rendered listing shared by department, shop-all and search pages. */
export async function ProductListing({ title, eyebrow, intro, category, q, searchParams, basePath, crumbs, subnav }: {
  title: string; eyebrow?: string; intro?: string; category?: string; q?: string; searchParams: Search; basePath: string;
  crumbs?: Array<{ name: string; href: string }>; subnav?: Array<{ name: string; href: string; active?: boolean }>;
}) {
  const query = toQuery(searchParams, { category, q });
  const facetQuery = new URLSearchParams();
  if (category) facetQuery.set('category', category);
  if (q) facetQuery.set('q', q);
  const [{ data: products, meta }, { data: facets }] = await Promise.all([
    serverApi<ProductCard[]>(`/products?${query}`, { notFoundOn404: true }),
    serverApi<Facets>(`/products/facets?${facetQuery}`, { notFoundOn404: true }),
  ]);
  const page = meta?.page ?? 1;
  const totalPages = meta?.totalPages ?? 1;
  const pageHref = (n: number) => {
    const p = toQuery(searchParams, { q });
    if (n > 1) p.set('page', String(n)); else p.delete('page');
    return `${basePath}?${p}`;
  };

  return (
    <Container className="py-8 sm:py-10">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="mb-4 text-xs text-muted">
          <ol className="flex flex-wrap gap-1.5">
            <li><Link href="/" className="hover:text-ink">Home</Link></li>
            {crumbs.map((c) => <li key={c.href} className="before:mr-1.5 before:content-['/']"><Link href={c.href} className="hover:text-ink">{c.name}</Link></li>)}
          </ol>
        </nav>
      )}
      <header className="mb-6">
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-rose-deep">{eyebrow}</p>}
        <h1 className="mt-1 text-3xl font-extrabold sm:text-4xl">{title}</h1>
        {intro && <p className="mt-2 text-muted">{intro}</p>}
      </header>
      {subnav && subnav.length > 0 && (
        <nav aria-label="Sub-categories" className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {subnav.map((s) => (
            <Link key={s.href} href={s.href} className={cx('shrink-0 rounded-full border px-4 py-2 text-sm', s.active ? 'border-ink bg-ink text-paper' : 'border-line bg-paper hover:border-ink')}>{s.name}</Link>
          ))}
        </nav>
      )}

      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <Suspense><Filters facets={facets} /></Suspense>
        <div>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <p className="text-sm text-muted" aria-live="polite">{meta?.total ?? 0} {meta?.total === 1 ? 'item' : 'items'}</p>
            <Suspense><SortSelect /></Suspense>
          </div>
          <div className="mb-5"><Suspense><ActiveFilters /></Suspense></div>
          {products.length ? (
            <ProductGrid products={products} priorityCount={4} />
          ) : (
            <EmptyState
              title={q ? `Nothing found for “${q}”` : 'No pieces match these filters'}
              body={q ? 'Check the spelling or try a broader term like “dress” or “bag”.' : 'Try removing a filter or two to see more.'}
              action={<ButtonLink href={q ? '/shop' : basePath} variant="secondary">{q ? 'Browse everything' : 'Clear filters'}</ButtonLink>}
            />
          )}
          {totalPages > 1 && (
            <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-1.5">
              {page > 1 && <Link href={pageHref(page - 1)} className="flex h-10 items-center rounded-sm border border-line bg-paper px-4 text-sm hover:border-ink">Previous</Link>}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                .map((n, i, arr) => (
                  <span key={n} className="flex items-center gap-1.5">
                    {i > 0 && n - arr[i - 1] > 1 && <span className="px-1 text-muted">…</span>}
                    <Link href={pageHref(n)} aria-current={n === page ? 'page' : undefined}
                      className={cx('flex h-10 min-w-10 items-center justify-center rounded-sm border px-3 text-sm', n === page ? 'border-ink bg-ink text-paper' : 'border-line bg-paper hover:border-ink')}>{n}</Link>
                  </span>
                ))}
              {page < totalPages && <Link href={pageHref(page + 1)} className="flex h-10 items-center rounded-sm border border-line bg-paper px-4 text-sm hover:border-ink">Next</Link>}
            </nav>
          )}
        </div>
      </div>
    </Container>
  );
}
