'use client';

import Image from 'next/image';
import Link from 'next/link';
import { discountPercent, formatMoney } from '@/lib/format';
import { useUi, useWishlist } from '@/lib/shop';
import type { ProductCard as Card } from '@/lib/types';
import { EyeIcon, HeartIcon, StarIcon } from './icons';
import { Badge, cx, Skeleton } from './ui';

export function Stars({ rating, size = 14, className }: { rating: number; size?: number; className?: string }) {
  return (
    <span className={cx('inline-flex text-ink', className)} role="img" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => <StarIcon key={i} width={size} height={size} filled={Math.max(0, Math.min(1, rating - i))} />)}
    </span>
  );
}

export function Price({ price, compareAt, currency = 'GHS', className }: { price: string; compareAt?: string | null; currency?: string; className?: string }) {
  const off = discountPercent(price, compareAt);
  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-2', className)}>
      <span className={cx('font-semibold', !!off && 'text-rose-deep')}>{formatMoney(price, currency)}</span>
      {!!off && (
        <>
          <s className="text-[0.9em] text-muted"><span className="sr-only">was </span>{formatMoney(compareAt!, currency)}</s>
          <span className="text-[0.8em] font-semibold text-rose-deep">-{off}%</span>
        </>
      )}
    </span>
  );
}

export function ProductCard({ product, priority = false }: { product: Card; priority?: boolean }) {
  const { ids, toggle } = useWishlist();
  const openQuickView = useUi((s) => s.openQuickView);
  const saved = ids.has(product.id);
  const off = discountPercent(product.price, product.compareAtPrice);

  return (
    <article className="group relative">
      <div className="relative aspect-[3/4] overflow-hidden rounded-sm bg-sand">
        <Link href={`/p/${product.slug}`} aria-label={product.name} className="absolute inset-0">
          {product.image && (
            <Image
              src={product.image.url} alt={product.image.alt} fill priority={priority}
              sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 48vw"
              className={cx('object-cover transition duration-500 ease-out group-hover:scale-[1.03]', product.hoverImage && 'group-hover:opacity-0')}
            />
          )}
          {product.hoverImage && (
            <Image src={product.hoverImage.url} alt="" fill sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 48vw"
              className="object-cover opacity-0 transition duration-500 group-hover:opacity-100" />
          )}
        </Link>
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1">
          {product.promotion?.type === 'FLASH_SALE' ? <Badge tone="ink">⚡ Flash -{product.promotion.percentOff}%</Badge> : !!off && <Badge tone="rose">-{off}%</Badge>}
          {product.isNew && <Badge tone="ink">New</Badge>}
          {!product.inStock && <Badge tone="neutral">Sold out</Badge>}
        </div>
        <button
          type="button"
          onClick={() => toggle(product.id)}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-paper/90 text-ink shadow-sm transition hover:scale-105 hover:bg-paper"
        >
          <HeartIcon width={18} height={18} filled={saved} className={saved ? 'text-rose-deep' : undefined} />
        </button>
        <button
          type="button"
          onClick={() => openQuickView(product.slug)}
          className="absolute inset-x-2 bottom-2 hidden h-10 items-center justify-center gap-2 rounded-sm bg-paper/95 text-xs font-semibold uppercase tracking-[0.12em] text-ink opacity-0 transition group-hover:opacity-100 focus:opacity-100 md:flex"
        >
          <EyeIcon width={16} height={16} /> Quick view
        </button>
      </div>
      <div className="mt-3 space-y-1">
        {product.brand && <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{product.brand.name}</p>}
        <h3 className="line-clamp-2 text-sm leading-snug">
          <Link href={`/p/${product.slug}`} className="hover:underline hover:underline-offset-4">{product.name}</Link>
        </h3>
        <Price price={product.price} compareAt={product.compareAtPrice} currency={product.currency} className="text-sm" />
        {product.promotion?.stockLeft != null && product.promotion.stockLeft <= 10 && <p className="text-xs font-semibold text-rose-deep">Only {product.promotion.stockLeft} left at this price</p>}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          {product.colors.length > 1 ? (
            <span className="flex items-center gap-1" aria-label={`${product.colors.length} colours`}>
              {product.colors.slice(0, 5).map((c) => (
                <span key={c.name} title={c.name} className="h-3 w-3 rounded-full border border-line" style={{ background: c.hex ?? '#ccc' }} />
              ))}
            </span>
          ) : <span />}
          {product.reviewCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Stars rating={product.rating} size={11} /> ({product.reviewCount})
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products, priorityCount = 0 }: { products: Card[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 xl:grid-cols-4">
      {products.map((p, i) => <li key={p.id}><ProductCard product={p} priority={i < priorityCount} /></li>)}
    </ul>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading products">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <Skeleton className="aspect-[3/4]" />
          <Skeleton className="mt-3 h-3 w-16" />
          <Skeleton className="mt-2 h-4 w-4/5" />
          <Skeleton className="mt-2 h-4 w-20" />
        </li>
      ))}
    </ul>
  );
}

/** Horizontal scrolling rail on mobile, 4-up grid on desktop. */
export function ProductRail({ title, href, products, eyebrow }: { title: string; href?: string; products: Card[]; eyebrow?: string }) {
  if (!products.length) return null;
  return (
    <section aria-label={title} className="py-10 sm:py-14">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-rose-deep">{eyebrow}</p>}
          <h2 className="mt-1 text-2xl font-extrabold sm:text-3xl">{title}</h2>
        </div>
        {href && <Link href={href} className="shrink-0 text-xs font-semibold uppercase tracking-[0.14em] underline underline-offset-4 hover:text-rose-deep">View all</Link>}
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible sm:px-0 lg:grid-cols-4 [&::-webkit-scrollbar]:hidden">
        {products.slice(0, 8).map((p) => (
          <li key={p.id} className="w-[44vw] shrink-0 snap-start sm:w-auto">
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}
