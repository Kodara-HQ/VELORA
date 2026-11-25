'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, apiWithMeta, ApiError } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatMoney } from '@/lib/format';
import { errorMessage } from '@/lib/shop';
import { Alert, Button, Field } from '../ui';
import { Panel, Select } from './ui';

export interface PromotionDetail {
  id: number; name: string; slug: string; type: 'FLASH_SALE' | 'PERCENTAGE_OFF' | 'FIXED_AMOUNT_OFF'; value: string | null; headline: string | null;
  bannerUrl: string | null; campaign: string | null; priority: number; startsAt: string; endsAt: string; isActive: boolean;
  state: 'LIVE' | 'SCHEDULED' | 'ENDED' | 'PAUSED';
  performance: { unitsSold: number; revenue: string; orders: number };
  products: Array<{ productId: number; name: string; styleCode: string; status: string; image: string | null; basePrice: string; salePrice: string | null; stockLimit: number | null; soldCount: number; promoPrice: string | null }>;
}

interface Row { productId: number; name: string; styleCode: string; image: string | null; basePrice: string; salePrice: string; stockLimit: string; soldCount: number }
interface SearchRow { id: number; name: string; styleCode: string; price: string; image: string | null; status: string }

/** datetime-local wants local time without a zone. */
const toLocal = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const inHours = (h: number) => toLocal(new Date(Date.now() + h * 3_600_000).toISOString());

export function PromotionForm({ promo, onSaved }: { promo?: PromotionDetail; onSaved?: (p: PromotionDetail) => void }) {
  const router = useRouter();
  const ended = promo?.state === 'ENDED';
  const [v, setV] = useState({
    name: promo?.name ?? '', type: promo?.type ?? 'FLASH_SALE', value: promo?.value ? String(Number(promo.value)) : '20',
    headline: promo?.headline ?? '', campaign: promo?.campaign ?? '', priority: String(promo?.priority ?? 0),
    startsAt: promo ? toLocal(promo.startsAt) : inHours(0), endsAt: promo ? toLocal(promo.endsAt) : inHours(48),
  });
  const [rows, setRows] = useState<Row[]>(promo?.products.map((p) => ({
    productId: p.productId, name: p.name, styleCode: p.styleCode, image: p.image, basePrice: p.basePrice,
    salePrice: p.salePrice ?? '', stockLimit: p.stockLimit != null ? String(p.stockLimit) : '', soldCount: p.soldCount,
  })) ?? []);
  const [search, setSearch] = useState('');
  const found = useQuery({
    queryKey: ['promo-product-search', search],
    queryFn: () => apiWithMeta<SearchRow[]>(`/admin/products${qs({ q: search, status: 'ACTIVE', pageSize: 8 })}`),
    enabled: search.trim().length >= 2,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: v.name, type: v.type, value: v.value ? Number(v.value) : undefined, headline: v.headline || undefined, campaign: v.campaign || undefined,
        priority: Number(v.priority) || 0, startsAt: new Date(v.startsAt).toISOString(), endsAt: new Date(v.endsAt).toISOString(),
        products: rows.map((r) => ({ productId: r.productId, salePrice: r.salePrice || undefined, stockLimit: r.stockLimit ? Number(r.stockLimit) : undefined })),
      };
      return promo ? api<PromotionDetail>(`/admin/promotions/${promo.id}`, { method: 'PUT', body }) : api<PromotionDetail>('/admin/promotions', { method: 'POST', body });
    },
    onSuccess: (p) => (promo ? onSaved?.(p) : router.replace(`/admin/promotions/${p.id}?created=1`)),
  });
  const errs = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const update = (id: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.productId === id ? { ...r, ...patch } : r)));
  const preview = (r: Row) => {
    const base = Number(r.basePrice);
    const val = Number(v.value) || 0;
    const p = r.salePrice ? Number(r.salePrice) : v.type === 'FIXED_AMOUNT_OFF' ? base - val : base * (1 - val / 100);
    return p > 0 && p < base ? formatMoney(p.toFixed(2)) : '—';
  };
  const cell = 'h-9 w-24 rounded-sm border border-line bg-paper px-2 text-sm focus:border-ink focus:outline-none';
  const onSubmit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        {ended && <Alert tone="info">This promotion has ended and can no longer be edited.</Alert>}
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        {save.isSuccess && promo && <Alert tone="success">Saved. Prices update in the store immediately.</Alert>}
        <Panel title={`Products (${rows.length})`}>
          {errs.products && <div className="mb-3"><Alert tone="danger">{errs.products}</Alert></div>}
          <div className="relative mb-4">
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Add products: search by name or style code" aria-label="Search products to add"
              disabled={ended} className="h-10 w-full rounded-sm border border-line bg-paper px-3 text-sm focus:border-ink focus:outline-none" />
            {search.trim().length >= 2 && found.data && (
              <ul className="absolute inset-x-0 top-11 z-10 max-h-72 overflow-y-auto rounded-sm border border-line bg-paper shadow-lg">
                {!found.data.data.length && <li className="px-3 py-3 text-sm text-muted">No live products match.</li>}
                {found.data.data.map((p) => {
                  const added = rows.some((r) => r.productId === p.id);
                  return (
                    <li key={p.id}>
                      <button type="button" disabled={added} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-sand disabled:opacity-50"
                        onClick={() => { setRows([...rows, { productId: p.id, name: p.name, styleCode: p.styleCode, image: p.image, basePrice: p.price, salePrice: '', stockLimit: '', soldCount: 0 }]); setSearch(''); }}>
                        <span className="h-10 w-8 shrink-0 overflow-hidden rounded-sm bg-sand">{p.image && <img src={p.image} alt="" className="h-full w-full object-cover" />}</span>
                        <span className="flex-1">{p.name} <span className="text-xs text-muted">{p.styleCode}</span></span>
                        <span>{formatMoney(p.price)}</span>{added && <span className="text-xs">Added</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {!rows.length ? <p className="text-sm text-muted">Add the products this promotion applies to.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-[0.1em] text-muted">
                  {['Product', 'Price', 'Fixed sale price', 'Units at this price', 'Sale price', 'Sold', ''].map((h) => <th key={h} className="px-1.5 pb-2 font-semibold">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.productId}>
                      <td className="p-1.5"><span className="flex items-center gap-2"><span className="h-10 w-8 shrink-0 overflow-hidden rounded-sm bg-sand">{r.image && <img src={r.image} alt="" className="h-full w-full object-cover" />}</span><span className="min-w-0"><span className="block truncate">{r.name}</span><span className="text-xs text-muted">{r.styleCode}</span></span></span></td>
                      <td className="p-1.5">{formatMoney(r.basePrice)}</td>
                      <td className="p-1.5"><input className={cell} inputMode="decimal" placeholder="Optional" value={r.salePrice} disabled={ended} onChange={(e) => update(r.productId, { salePrice: e.target.value })} aria-label={`Fixed sale price for ${r.name}`} /></td>
                      <td className="p-1.5"><input className={cell} inputMode="numeric" placeholder="Unlimited" value={r.stockLimit} disabled={ended} onChange={(e) => update(r.productId, { stockLimit: e.target.value.replace(/\D/g, '') })} aria-label={`Unit limit for ${r.name}`} /></td>
                      <td className="p-1.5 font-semibold text-rose-deep">{preview(r)}</td>
                      <td className="p-1.5">{r.soldCount}</td>
                      <td className="p-1.5">{!ended && <button type="button" className="text-xs font-semibold text-danger" onClick={() => setRows(rows.filter((x) => x.productId !== r.productId))}>Remove</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">Leave “fixed sale price” empty to use the promotion’s discount. “Units at this price” caps a flash sale: once sold, the product returns to its normal price.</p>
        </Panel>
      </div>
      <div className="space-y-6">
        <Panel title="Promotion">
          <div className="space-y-4">
            <Field label="Name" value={v.name} onChange={set('name')} required error={errs.name} disabled={ended} />
            <Select label="Type" value={v.type} onChange={set('type')} disabled={ended}>
              <option value="FLASH_SALE">Flash sale (countdown, % off)</option>
              <option value="PERCENTAGE_OFF">Percentage off</option>
              <option value="FIXED_AMOUNT_OFF">Amount off (GH₵)</option>
            </Select>
            <Field label={v.type === 'FIXED_AMOUNT_OFF' ? 'Amount off (GH₵)' : 'Percent off'} inputMode="decimal" value={v.value} onChange={set('value')} error={errs.value} disabled={ended}
              hint={v.type === 'FLASH_SALE' ? 'Optional if every product has a fixed sale price' : undefined} />
            <Field label="Starts" type="datetime-local" value={v.startsAt} onChange={set('startsAt')} error={errs.startsAt} disabled={ended} />
            <Field label="Ends" type="datetime-local" value={v.endsAt} onChange={set('endsAt')} error={errs.endsAt} disabled={ended} />
            <Field label="Headline (shown to shoppers)" value={v.headline} onChange={set('headline')} placeholder="25% off selected pieces" disabled={ended} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Campaign" value={v.campaign} onChange={set('campaign')} placeholder="e.g. weekend" disabled={ended} />
              <Field label="Priority" inputMode="numeric" value={v.priority} onChange={set('priority')} hint="Higher wins on overlap" disabled={ended} />
            </div>
            {!ended && <Button type="submit" block loading={save.isPending} disabled={!rows.length}>{promo ? 'Save changes' : 'Create promotion'}</Button>}
          </div>
        </Panel>
      </div>
    </form>
  );
}
