'use client';

import { useMemo, useState } from 'react';
import { errorMessage, useCartMutations, useWishlist } from '@/lib/shop';
import type { ProductDetail, SizeGuide } from '@/lib/types';
import { Dialog } from './dialog';
import { HeartIcon } from './icons';
import { Price } from './product-card';
import { Alert, Button, cx } from './ui';

/** Colour → size → quantity → add to bag. Stock is per variant, so sizes grey out per colour. */
export function VariantPicker({ product, onColorChange, compact = false }: {
  product: ProductDetail; onColorChange?: (color: string | null) => void; compact?: boolean;
}) {
  const colors = useMemo(() => {
    const m = new Map<string, { hex: string | null; available: number }>();
    for (const v of product.variants) {
      if (!v.color) continue;
      const c = m.get(v.color) ?? { hex: v.colorHex, available: 0 };
      c.available += v.available;
      m.set(v.color, c);
    }
    return [...m];
  }, [product.variants]);

  const firstInStock = product.variants.find((v) => v.available > 0) ?? product.variants[0];
  const [color, setColor] = useState<string | null>(firstInStock?.color ?? null);
  const sizes = product.variants.filter((v) => v.color === color || !v.color);
  const onlySize = sizes.length === 1 ? sizes[0] : null;
  const [size, setSize] = useState<string | null>(onlySize?.size ?? null);
  const [qty, setQty] = useState(1);
  const [guideOpen, setGuideOpen] = useState(false);
  const [needSize, setNeedSize] = useState(false);
  const { add } = useCartMutations();
  const wishlist = useWishlist();

  const variant = product.variants.find((v) => (v.color ?? null) === color && (v.size ?? null) === (onlySize ? onlySize.size : size));
  const maxQty = Math.min(variant?.available ?? 0, 10);

  const pickColor = (c: string) => {
    setColor(c);
    onColorChange?.(c);
    const stillThere = product.variants.find((v) => v.color === c && v.size === size && v.available > 0);
    if (!stillThere) setSize(null);
    setQty(1);
  };

  const submit = () => {
    if (!variant) { setNeedSize(true); return; }
    add.mutate({ variantId: variant.id, quantity: qty });
  };

  return (
    <div className="space-y-6">
      <Price price={variant?.price ?? product.price} compareAt={variant?.compareAtPrice ?? product.compareAtPrice} className={compact ? 'text-xl' : 'text-2xl'} />

      {colors.length > 0 && (
        <fieldset>
          <legend className="mb-2.5 text-xs font-semibold uppercase tracking-[0.12em]">
            Colour: <span className="font-normal normal-case tracking-normal text-muted">{color}</span>
          </legend>
          <div className="flex flex-wrap gap-2.5">
            {colors.map(([name, c]) => (
              <button key={name} type="button" onClick={() => pickColor(name)} aria-pressed={color === name} title={name}
                aria-label={`${name}${c.available === 0 ? ' (sold out)' : ''}`}
                className={cx('relative h-9 w-9 rounded-full border-2 p-0.5 transition', color === name ? 'border-ink' : 'border-transparent hover:border-stone')}>
                <span className="block h-full w-full rounded-full border border-line" style={{ background: c.hex ?? '#ddd' }} />
                {c.available === 0 && <span className="absolute inset-0 m-auto h-px w-8 -rotate-45 bg-ink/60" />}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {!onlySize && (
        <fieldset>
          <div className="mb-2.5 flex items-center justify-between">
            <legend className={cx('text-xs font-semibold uppercase tracking-[0.12em]', needSize && !size && 'text-danger')}>
              {needSize && !size ? 'Please choose a size' : <>Size{size && <span className="font-normal normal-case tracking-normal text-muted">: {size}</span>}</>}
            </legend>
            {product.sizeGuide && (
              <button type="button" onClick={() => setGuideOpen(true)} className="text-xs font-semibold underline underline-offset-4">Size guide</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {sizes.map((v) => (
              <button key={v.id} type="button" disabled={v.available === 0} onClick={() => { setSize(v.size); setNeedSize(false); setQty(1); }}
                aria-pressed={size === v.size}
                className={cx('h-11 min-w-12 rounded-sm border px-3 text-sm font-medium transition',
                  size === v.size ? 'border-ink bg-ink text-paper' : 'border-line bg-paper hover:border-ink',
                  v.available === 0 && 'cursor-not-allowed border-line bg-sand text-stone line-through hover:border-line')}>
                {v.size}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {variant && (
        <p className={cx('text-sm', variant.available === 0 ? 'text-danger' : variant.lowStock ? 'font-semibold text-rose-deep' : 'text-success')}>
          {variant.available === 0 ? 'Sold out in this option' : variant.lowStock ? `Hurry — only ${variant.available} left` : 'In stock, ready to ship'}
        </p>
      )}

      <div className="flex gap-3">
        <label className="sr-only" htmlFor={`qty-${product.id}`}>Quantity</label>
        <select id={`qty-${product.id}`} value={qty} onChange={(e) => setQty(Number(e.target.value))} disabled={!variant || maxQty === 0}
          className="h-14 w-20 rounded-sm border border-line bg-paper px-3 text-sm disabled:opacity-50">
          {Array.from({ length: Math.max(maxQty, 1) }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </select>
        <Button size="lg" className="flex-1" onClick={submit} loading={add.isPending} disabled={variant?.available === 0}>
          {variant?.available === 0 ? 'Sold out' : 'Add to bag'}
        </Button>
        <button type="button" onClick={() => wishlist.toggle(product.id)} aria-pressed={wishlist.ids.has(product.id)}
          aria-label={wishlist.ids.has(product.id) ? 'Remove from wishlist' : 'Save to wishlist'}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border border-line bg-paper hover:border-ink">
          <HeartIcon filled={wishlist.ids.has(product.id)} className={wishlist.ids.has(product.id) ? 'text-rose-deep' : undefined} />
        </button>
      </div>
      {add.isError && <Alert tone="danger">{errorMessage(add.error)}</Alert>}

      {product.sizeGuide && (
        <Dialog open={guideOpen} onClose={() => setGuideOpen(false)} label="Size guide" className="max-w-xl">
          <SizeGuideTable guide={product.sizeGuide} />
        </Dialog>
      )}
    </div>
  );
}

export function SizeGuideTable({ guide }: { guide: SizeGuide }) {
  return (
    <div className="p-6 sm:p-8">
      <h2 className="text-2xl font-extrabold">Size guide</h2>
      {guide.note && <p className="mt-2 text-sm text-muted">{guide.note}</p>}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[360px] border-collapse text-sm">
          <caption className="sr-only">Measurements in {guide.unit}</caption>
          <thead>
            <tr>{guide.columns.map((c) => <th key={c} scope="col" className="border-b-2 border-ink px-3 py-2 text-left font-semibold">{c}</th>)}</tr>
          </thead>
          <tbody>
            {guide.rows.map((r) => (
              <tr key={r[0]} className="odd:bg-paper">
                {r.map((cell, i) => i === 0
                  ? <th key={i} scope="row" className="border-b border-line px-3 py-2 text-left font-semibold">{cell}</th>
                  : <td key={i} className="border-b border-line px-3 py-2">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">All measurements in {guide.unit}.</p>
    </div>
  );
}
