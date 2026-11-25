'use client';

import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { errorMessage, useCart, useCartMutations, useUi } from '@/lib/shop';
import type { CartLine, ProductDetail } from '@/lib/types';
import { Dialog } from './dialog';
import { Stars } from './product-card';
import { Alert, ButtonLink, EmptyState, Skeleton } from './ui';
import { VariantPicker } from './variant-picker';

/** Slide-out bag, opened by the header icon and after every add-to-bag. */
export function CartDrawer() {
  const { cartOpen, cartNotice, closeCart } = useUi();
  const cart = useCart();
  const data = cart.data;
  return (
    <Dialog open={cartOpen} onClose={closeCart} label="Your bag" variant="right">
      <div className="flex h-16 shrink-0 items-center border-b border-line px-5">
        <h2 className="text-lg font-extrabold">Your bag {data?.itemCount ? <span className="font-medium text-muted">({data.itemCount})</span> : null}</h2>
      </div>
      {cartNotice && <div className="px-5 pt-4"><Alert tone="warning">{cartNotice}</Alert></div>}
      <div className="flex-1 overflow-y-auto px-5">
        {cart.isPending ? (
          <div className="space-y-4 py-5">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        ) : !data?.items.length ? (
          <EmptyState title="Your bag is empty" body="Pieces you add will wait here while you keep shopping."
            action={<ButtonLink href="/shop?sort=newest" variant="secondary">Shop new in</ButtonLink>} />
        ) : (
          <ul className="divide-y divide-line">{data.items.map((l) => <CartLineRow key={l.id} line={l} compact />)}</ul>
        )}
      </div>
      {!!data?.items.length && (
        <div className="shrink-0 space-y-3 border-t border-line bg-paper px-5 py-5">
          {data.coupon?.valid && <Row label={`Code ${data.coupon.code}`} value={`−${formatMoney(data.discountTotal)}`} accent />}
          <Row label="Subtotal" value={formatMoney(data.estimatedTotal)} strong />
          <p className="text-xs text-muted">Delivery is calculated at checkout.</p>
          <div className="grid grid-cols-2 gap-2">
            <ButtonLink href="/cart" variant="secondary" block>View bag</ButtonLink>
            <ButtonLink href="/checkout" block>Checkout</ButtonLink>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function Row({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between text-sm ${strong ? 'text-base font-bold' : ''} ${accent ? 'text-rose-deep' : ''}`}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

export function CartLineRow({ line, compact = false }: { line: CartLine; compact?: boolean }) {
  const { update, remove } = useCartMutations();
  const [err, setErr] = useState<string | null>(null);
  const busy = (update.isPending && update.variables?.id === line.id) || (remove.isPending && remove.variables === line.id);
  const max = Math.max(line.available, line.quantity, 1);
  const closeCart = useUi((s) => s.closeCart);

  return (
    <li className={`flex gap-4 py-5 ${busy ? 'opacity-60' : ''}`}>
      <Link href={`/p/${line.slug}`} onClick={closeCart} className={`relative shrink-0 overflow-hidden rounded-sm bg-sand ${compact ? 'h-28 w-20' : 'h-36 w-28'}`}>
        {line.image && <Image src={line.image} alt={line.name} fill sizes="112px" className="object-cover" />}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex justify-between gap-3">
          <div className="min-w-0">
            {line.brand && <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{line.brand}</p>}
            <Link href={`/p/${line.slug}`} onClick={closeCart} className="line-clamp-2 text-sm font-medium hover:underline">{line.name}</Link>
            <p className="mt-0.5 text-xs text-muted">{line.variantLabel}</p>
            {line.promotion && <p className="mt-0.5 text-xs font-semibold text-rose-deep">{line.promotion.name} price</p>}
          </div>
          <p className="shrink-0 text-sm font-semibold">{formatMoney(line.lineTotal)}</p>
        </div>
        {line.issue && (
          <p className="mt-2 text-xs font-semibold text-danger">
            {line.issue === 'UNAVAILABLE' ? 'No longer available — please remove' : line.issue === 'OUT_OF_STOCK' ? 'Sold out — please remove' : `Only ${line.available} left — reduce quantity`}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            Qty
            <select value={line.quantity} disabled={busy || line.issue === 'UNAVAILABLE'}
              onChange={(e) => { setErr(null); update.mutate({ id: line.id, quantity: Number(e.target.value) }, { onError: (x) => setErr(errorMessage(x)) }); }}
              className="h-9 rounded-sm border border-line bg-paper px-2 text-sm text-ink">
              {Array.from({ length: Math.min(max, 10) }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => remove.mutate(line.id, { onError: (x) => setErr(errorMessage(x)) })}
            className="text-xs font-semibold underline underline-offset-4 hover:text-danger">Remove</button>
        </div>
        {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
      </div>
    </li>
  );
}

/** Quick view: full variant picker without leaving the listing. */
export function QuickView() {
  const { quickView, closeQuickView } = useUi();
  const q = useQuery({
    queryKey: ['product', quickView],
    queryFn: () => api<ProductDetail>(`/products/${quickView}`, { auth: false }),
    enabled: !!quickView,
  });
  const [color, setColor] = useState<string | null>(null);
  const p = q.data;
  const image = p && (p.images.find((i) => i.color === color) ?? p.images[0]);

  return (
    <Dialog open={!!quickView} onClose={() => { closeQuickView(); setColor(null); }} label={p ? `Quick view: ${p.name}` : 'Quick view'}>
      {q.isPending ? (
        <div className="grid gap-6 p-6 md:grid-cols-2"><Skeleton className="aspect-[3/4]" /><div className="space-y-3"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-6 w-32" /><Skeleton className="h-40" /></div></div>
      ) : q.isError ? (
        <div className="p-8"><Alert tone="danger">{errorMessage(q.error)}</Alert></div>
      ) : p && (
        <div className="grid md:grid-cols-2">
          <div className="relative aspect-[3/4] bg-sand">
            {image && <Image src={image.url} alt={image.alt} fill sizes="(min-width: 768px) 448px, 100vw" className="object-cover" />}
          </div>
          <div className="space-y-5 p-6 sm:p-8">
            <div>
              {p.brand && <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{p.brand.name}</p>}
              <h2 className="mt-1 pr-10 text-2xl font-extrabold leading-tight">{p.name}</h2>
              {p.reviewCount > 0 && <p className="mt-2 flex items-center gap-2 text-xs text-muted"><Stars rating={p.rating} /> {p.reviewCount} reviews</p>}
            </div>
            <VariantPicker product={p} onColorChange={setColor} compact />
            <Link href={`/p/${p.slug}`} onClick={closeQuickView} className="inline-block text-sm font-semibold underline underline-offset-4">View full details</Link>
          </div>
        </div>
      )}
    </Dialog>
  );
}
