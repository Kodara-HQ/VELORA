'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import type { Facets } from '@/lib/types';
import { Dialog } from './dialog';
import { FilterIcon } from './icons';
import { Button, Checkbox, cx, Spinner } from './ui';

const SORTS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'newest', label: 'Newest' },
  { value: 'popular', label: 'Best selling' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Top rated' },
];

/** All filter state lives in the URL, so results are shareable, bookmarkable and server-rendered. */
function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const list = (k: string) => params.get(k)?.split(',').filter(Boolean) ?? [];
  const push = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete('page');
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  const toggle = (k: string, v: string) => push((p) => {
    const cur = new Set(p.get(k)?.split(',').filter(Boolean) ?? []);
    if (cur.has(v)) cur.delete(v); else cur.add(v);
    if (cur.size) p.set(k, [...cur].join(',')); else p.delete(k);
  });
  const set = (k: string, v: string | null) => push((p) => (v ? p.set(k, v) : p.delete(k)));
  return { params, list, toggle, set, push, pending };
}

export function SortSelect() {
  const { params, set, pending } = useUrlState();
  return (
    <label className="flex items-center gap-2 text-sm">
      {pending && <Spinner className="text-muted" />}
      <span className="hidden text-muted sm:inline">Sort by</span>
      <select value={params.get('sort') ?? 'recommended'} onChange={(e) => set('sort', e.target.value === 'recommended' ? null : e.target.value)}
        className="h-10 rounded-sm border border-line bg-paper px-3 text-sm font-medium">
        {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    </label>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group border-b border-line py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-[0.14em]">
        {title}<span className="text-lg leading-none text-muted group-open:rotate-45 transition">+</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function FilterPanel({ facets }: { facets: Facets }) {
  const { list, toggle, set, params, push } = useUrlState();
  const [min, setMin] = useState(params.get('minPrice') ?? '');
  const [max, setMax] = useState(params.get('maxPrice') ?? '');
  const sizes = list('size');
  const colors = list('color');
  const brands = list('brand');

  return (
    <div>
      <Section title="Availability">
        <div className="space-y-2.5">
          <Checkbox label="In stock only" checked={params.get('inStock') === 'true'} onChange={(e) => set('inStock', e.target.checked ? 'true' : null)} />
          <Checkbox label="On sale" checked={params.get('onSale') === 'true'} onChange={(e) => set('onSale', e.target.checked ? 'true' : null)} />
        </div>
      </Section>
      {facets.sizes.length > 0 && (
        <Section title="Size">
          <div className="flex flex-wrap gap-2">
            {facets.sizes.map((s) => (
              <button key={s.name} type="button" onClick={() => toggle('size', s.name)} aria-pressed={sizes.includes(s.name)}
                className={cx('h-9 min-w-11 rounded-sm border px-2.5 text-xs font-medium', sizes.includes(s.name) ? 'border-ink bg-ink text-paper' : 'border-line bg-paper hover:border-ink')}>
                {s.name}
              </button>
            ))}
          </div>
        </Section>
      )}
      {facets.colors.length > 0 && (
        <Section title="Colour">
          <ul className="grid grid-cols-2 gap-2">
            {facets.colors.map((c) => (
              <li key={c.name}>
                <button type="button" onClick={() => toggle('color', c.name)} aria-pressed={colors.includes(c.name)}
                  className={cx('flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 text-left text-xs', colors.includes(c.name) ? 'border-ink' : 'border-transparent hover:border-line')}>
                  <span className="h-4 w-4 shrink-0 rounded-full border border-line" style={{ background: c.hex ?? '#ddd' }} />
                  <span className="truncate">{c.name}</span>
                  <span className="ml-auto text-muted">{c.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Price (GH₵)">
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); push((p) => { min ? p.set('minPrice', min) : p.delete('minPrice'); max ? p.set('maxPrice', max) : p.delete('maxPrice'); }); }}>
          <label className="flex-1 text-xs text-muted">Min
            <input type="number" inputMode="numeric" min={0} value={min} onChange={(e) => setMin(e.target.value)} placeholder={facets.price.min.split('.')[0]}
              className="mt-1 h-10 w-full rounded-sm border border-line bg-paper px-2 text-sm text-ink" />
          </label>
          <label className="flex-1 text-xs text-muted">Max
            <input type="number" inputMode="numeric" min={0} value={max} onChange={(e) => setMax(e.target.value)} placeholder={facets.price.max.split('.')[0]}
              className="mt-1 h-10 w-full rounded-sm border border-line bg-paper px-2 text-sm text-ink" />
          </label>
          <Button type="submit" size="sm" variant="secondary" className="h-10">Go</Button>
        </form>
      </Section>
      {facets.brands.length > 0 && (
        <Section title="Brand">
          <div className="space-y-2.5">
            {facets.brands.map((b) => (
              <Checkbox key={b.slug} label={<span>{b.name} <span className="text-muted">({b.count})</span></span>} checked={brands.includes(b.slug)} onChange={() => toggle('brand', b.slug)} />
            ))}
          </div>
        </Section>
      )}
      <Section title="Rating" defaultOpen={false}>
        <div className="space-y-2.5">
          {[4, 3].map((r) => (
            <Checkbox key={r} label={`${r} stars & up`} checked={params.get('minRating') === String(r)} onChange={(e) => set('minRating', e.target.checked ? String(r) : null)} />
          ))}
        </div>
      </Section>
    </div>
  );
}

export function ActiveFilters() {
  const { params, toggle, set, push } = useUrlState();
  const chips: Array<{ label: string; clear: () => void }> = [];
  for (const k of ['size', 'color', 'brand'] as const) for (const v of params.get(k)?.split(',').filter(Boolean) ?? []) chips.push({ label: v.replace(/-/g, ' '), clear: () => toggle(k, v) });
  if (params.get('inStock')) chips.push({ label: 'In stock', clear: () => set('inStock', null) });
  if (params.get('onSale')) chips.push({ label: 'On sale', clear: () => set('onSale', null) });
  if (params.get('minRating')) chips.push({ label: `${params.get('minRating')}★ & up`, clear: () => set('minRating', null) });
  if (params.get('minPrice') || params.get('maxPrice')) chips.push({ label: `GH₵${params.get('minPrice') ?? 0}–${params.get('maxPrice') ?? '∞'}`, clear: () => push((p) => { p.delete('minPrice'); p.delete('maxPrice'); }) });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <button key={c.label} type="button" onClick={c.clear} className="flex items-center gap-1.5 rounded-full border border-ink bg-paper px-3 py-1 text-xs font-medium capitalize hover:bg-sand">
          {c.label} <span aria-hidden="true">×</span><span className="sr-only">remove filter</span>
        </button>
      ))}
      <button type="button" onClick={() => push((p) => { for (const k of ['size', 'color', 'brand', 'inStock', 'onSale', 'minRating', 'minPrice', 'maxPrice']) p.delete(k); })}
        className="text-xs font-semibold underline underline-offset-4">Clear all</button>
    </div>
  );
}

export function Filters({ facets }: { facets: Facets }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="hidden lg:block" aria-label="Filters"><FilterPanel facets={facets} /></aside>
      <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => setOpen(true)}><FilterIcon width={16} height={16} /> Filter</Button>
      <Dialog open={open} onClose={() => setOpen(false)} label="Filters" variant="right">
        <div className="flex h-16 shrink-0 items-center border-b border-line px-5"><h2 className="text-lg font-extrabold">Filter</h2></div>
        <div className="flex-1 overflow-y-auto px-5"><FilterPanel facets={facets} /></div>
        <div className="border-t border-line p-4"><Button block onClick={() => setOpen(false)}>Show results</Button></div>
      </Dialog>
    </>
  );
}
