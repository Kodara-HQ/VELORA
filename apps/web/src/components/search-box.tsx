'use client';

import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { SearchIcon } from './icons';
import { cx } from './ui';

interface Suggestions {
  products: Array<{ slug: string; name: string; price: string; currency: string; image: string | null }>;
  categories: Array<{ name: string; slug: string; parent: string | null }>;
  brands: Array<{ name: string; slug: string }>;
  didYouMean?: string | null;
}

type Option = { key: string; label: string; href: string; kind: 'term' | 'product' | 'category' | 'brand'; meta?: string; image?: string | null };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SearchBox({ className, autoFocus, onNavigate }: { className?: string; autoFocus?: boolean; onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(pathname === '/search' ? params.get('q') ?? '' : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const term = useDebounced(q.trim(), 180);

  const trending = useQuery({ queryKey: ['trending'], queryFn: () => api<string[]>('/search/trending'), staleTime: 300_000, enabled: open });
  const suggest = useQuery({
    queryKey: ['suggest', term],
    queryFn: ({ signal }) => api<Suggestions>(`/search/suggest?q=${encodeURIComponent(term)}`, { signal }),
    enabled: open && term.length >= 2,
    staleTime: 60_000,
  });

  const options: Option[] = term.length >= 2 && suggest.data
    ? [
        ...(suggest.data.didYouMean ? [{ key: `d${suggest.data.didYouMean}`, kind: 'term' as const, label: `Did you mean “${suggest.data.didYouMean}”?`, href: `/search?q=${encodeURIComponent(suggest.data.didYouMean)}` }] : []),
        ...suggest.data.categories.map((c) => ({ key: `c${c.slug}`, kind: 'category' as const, label: c.name, meta: c.parent ? `in ${c.parent}` : 'Department', href: `/c/${c.slug}` })),
        ...suggest.data.brands.map((b) => ({ key: `b${b.slug}`, kind: 'brand' as const, label: b.name, meta: 'Brand', href: `/search?q=${encodeURIComponent(b.name)}` })),
        ...suggest.data.products.map((p) => ({ key: `p${p.slug}`, kind: 'product' as const, label: p.name, meta: formatMoney(p.price, p.currency), image: p.image, href: `/p/${p.slug}` })),
      ]
    : term.length < 2
      ? (trending.data ?? []).map((t) => ({ key: `t${t}`, kind: 'term' as const, label: t, href: `/search?q=${encodeURIComponent(t)}` }))
      : [];

  useEffect(() => setActive(-1), [term]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    onNavigate?.();
    router.push(href);
  };
  const submit = () => {
    if (active >= 0 && options[active]) return go(options[active].href);
    if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, -1)); }
    else if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') setOpen(false);
  };

  const showPanel = open && (options.length > 0 || (term.length >= 2 && !suggest.isFetching));

  return (
    <div ref={wrap} className={cx('relative', className)}>
      <form role="search" onSubmit={(e) => { e.preventDefault(); submit(); }} className="relative">
        <label htmlFor={`${listId}-input`} className="sr-only">Search VÉLORA</label>
        <SearchIcon width={18} height={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          id={`${listId}-input`}
          type="search"
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search dresses, kente, sneakers…"
          autoComplete="off"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={`${listId}-list`}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className="h-11 w-full rounded-full border border-line bg-paper pl-10 pr-4 text-sm placeholder:text-muted focus:border-ink focus:outline-none"
        />
      </form>
      {showPanel && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-sm border border-line bg-paper shadow-xl animate-fade-up">
          {term.length < 2 && options.length > 0 && <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Trending searches</p>}
          {term.length >= 2 && options.length === 0 && (
            <p className="px-4 py-4 text-sm text-muted">No suggestions. Press Enter to search for “{term}”.</p>
          )}
          <ul id={`${listId}-list`} role="listbox" className={cx(term.length < 2 ? 'flex flex-wrap gap-2 p-4 pt-2' : 'py-2')}>
            {options.map((o, i) => (
              <li key={o.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                {o.kind === 'term' ? (
                  <button type="button" onClick={() => go(o.href)} className={cx('rounded-full border px-3 py-1.5 text-sm', i === active ? 'border-ink bg-ink text-paper' : 'border-line hover:border-ink')}>
                    {o.label}
                  </button>
                ) : (
                  <button type="button" onClick={() => go(o.href)} onMouseEnter={() => setActive(i)}
                    className={cx('flex w-full items-center gap-3 px-4 py-2 text-left text-sm', i === active && 'bg-sand')}>
                    {o.kind === 'product' ? (
                      <span className="relative h-12 w-9 shrink-0 overflow-hidden rounded-sm bg-sand">
                        {o.image && <Image src={o.image} alt="" fill sizes="36px" className="object-cover" />}
                      </span>
                    ) : (
                      <SearchIcon width={16} height={16} className="mx-2.5 shrink-0 text-muted" />
                    )}
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.meta && <span className="shrink-0 text-xs text-muted">{o.meta}</span>}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
