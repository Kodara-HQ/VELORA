'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { uploadFiles } from '@/lib/admin';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/shop';
import { Alert, Button, Checkbox, Field } from '../ui';
import { Panel, Select, TextArea } from './ui';

export interface AdminCategory { id: number; name: string; slug: string; parentId: number | null; isActive: boolean; productCount: number; children: AdminCategory[] }
interface Brand { id: number; name: string }
interface Warehouse { id: number; code: string; name: string }
export interface AdminProduct {
  id: number; name: string; slug: string; styleCode: string; categoryId: number; brandId: number | null; vendorId: number | null; status: string;
  shortDescription: string | null; description: string | null; material: string | null; careInstructions: string | null; videoUrl: string | null;
  basePrice: string; compareAtPrice: string | null; isFeatured: boolean; tags: string[] | null; rejectionReason: string | null;
  images: Array<{ id: number; url: string; color: string | null; altText: string | null }>;
  attributes: Array<{ name: string; value: string }>;
  variants: Array<{ id: number; sku: string; color: string | null; colorHex: string | null; size: string | null; price: string | null; compareAtPrice: string | null; costPrice: string | null; isActive: boolean;
    inventory: Array<{ warehouse: Warehouse; onHand: number; reserved: number; available: number }> }>;
}

interface VariantRow { key: string; id?: number; sku: string; color: string; colorHex: string; size: string; price: string; compareAtPrice: string; costPrice: string; isActive: boolean; stock: Record<number, string> }

const newKey = () => Math.random().toString(36).slice(2);
export function flattenCategories(tree: AdminCategory[], depth = 0): Array<AdminCategory & { depth: number }> {
  return tree.flatMap((c) => [{ ...c, depth }, ...flattenCategories(c.children, depth + 1)]);
}

export function ProductForm({ product, onSaved }: { product?: AdminProduct; onSaved?: (p: AdminProduct) => void }) {
  const router = useRouter();
  const cats = useQuery({ queryKey: ['admin-categories'], queryFn: () => api<AdminCategory[]>('/admin/categories') });
  const brands = useQuery({ queryKey: ['admin-brands'], queryFn: () => api<Brand[]>('/admin/brands') });
  const warehouses = useQuery({ queryKey: ['admin-warehouses'], queryFn: () => api<Warehouse[]>('/admin/warehouses') });

  const [v, setV] = useState({
    name: product?.name ?? '', slug: product?.slug ?? '', categoryId: product ? String(product.categoryId) : '', brandId: product?.brandId ? String(product.brandId) : '',
    status: product?.status ?? 'DRAFT', basePrice: product?.basePrice ?? '', compareAtPrice: product?.compareAtPrice ?? '', isFeatured: product?.isFeatured ?? false,
    shortDescription: product?.shortDescription ?? '', description: product?.description ?? '', material: product?.material ?? '',
    careInstructions: product?.careInstructions ?? '', videoUrl: product?.videoUrl ?? '', tags: (product?.tags ?? []).join(', '),
  });
  const [images, setImages] = useState(product?.images.map((i) => ({ key: newKey(), url: i.url, color: i.color ?? '', alt: i.altText ?? '' })) ?? []);
  const [attributes, setAttributes] = useState(product?.attributes.map((a) => ({ key: newKey(), ...a })) ?? []);
  const [variants, setVariants] = useState<VariantRow[]>(product?.variants.map((x) => ({
    key: newKey(), id: x.id, sku: x.sku, color: x.color ?? '', colorHex: x.colorHex ?? '', size: x.size ?? '', price: x.price ?? '',
    compareAtPrice: x.compareAtPrice ?? '', costPrice: x.costPrice ?? '', isActive: x.isActive, stock: {},
  })) ?? []);
  const [gen, setGen] = useState({ colors: '', sizes: '' });
  const [imageUrl, setImageUrl] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const flatCats = useMemo(() => flattenCategories(cats.data ?? []), [cats.data]);
  const colorOptions = [...new Set(variants.map((x) => x.color).filter(Boolean))];

  const upload = useMutation({
    mutationFn: (files: File[]) => uploadFiles<Array<{ url: string }>>('/admin/uploads/images', 'files', files),
    onSuccess: (stored) => setImages((cur) => [...cur, ...stored.map((s) => ({ key: newKey(), url: s.url, color: '', alt: '' }))]),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: v.name, slug: v.slug || undefined, categoryId: Number(v.categoryId) || undefined, brandId: v.brandId ? Number(v.brandId) : null,
        status: v.status, basePrice: v.basePrice, compareAtPrice: v.compareAtPrice || undefined, isFeatured: v.isFeatured,
        shortDescription: v.shortDescription, description: v.description, material: v.material, careInstructions: v.careInstructions, videoUrl: v.videoUrl,
        tags: v.tags.split(',').map((t) => t.trim()).filter(Boolean),
        images: images.map((i) => ({ url: i.url, color: i.color || undefined, alt: i.alt || undefined })),
        attributes: attributes.filter((a) => a.name.trim() && a.value.trim()).map(({ name, value }) => ({ name, value })),
        variants: variants.map((x) => ({
          id: x.id, sku: x.id ? x.sku : x.sku || undefined, color: x.color, colorHex: x.colorHex, size: x.size, price: x.price, compareAtPrice: x.compareAtPrice,
          costPrice: x.costPrice, isActive: x.isActive,
          ...(!x.id && { stock: Object.entries(x.stock).filter(([, q]) => Number(q) > 0).map(([w, q]) => ({ warehouseId: Number(w), quantity: Number(q) })) }),
        })),
      };
      return product
        ? api<AdminProduct>(`/admin/products/${product.id}`, { method: 'PUT', body })
        : api<AdminProduct>('/admin/products', { method: 'POST', body });
    },
    onSuccess: (p) => {
      setErrors({});
      if (!product) router.replace(`/admin/products/${p.id}?created=1`);
      else onSaved?.(p);
    },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors); },
  });

  const generate = () => {
    const colors = gen.colors.split(',').map((s) => s.trim()).filter(Boolean);
    const sizes = gen.sizes.split(',').map((s) => s.trim()).filter(Boolean);
    const rows: VariantRow[] = [];
    for (const c of colors.length ? colors : ['']) for (const s of sizes.length ? sizes : ['']) {
      if (variants.some((x) => x.color === c && x.size === s)) continue;
      rows.push({ key: newKey(), sku: '', color: c, colorHex: variants.find((x) => x.color === c)?.colorHex ?? '', size: s, price: '', compareAtPrice: '', costPrice: '', isActive: true, stock: {} });
    }
    setVariants([...variants, ...rows]);
    setGen({ colors: '', sizes: '' });
  };
  const updateVariant = (key: string, patch: Partial<VariantRow>) => setVariants((cur) => cur.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const moveImage = (i: number, d: -1 | 1) => setImages((cur) => {
    const next = [...cur];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (v.name.trim().length < 2) local.name = 'Enter a product name';
    if (!v.categoryId) local.categoryId = 'Choose a category';
    if (!/^\d+(\.\d{1,2})?$/.test(v.basePrice)) local.basePrice = 'Enter a price like 249.00';
    if (v.compareAtPrice && Number(v.compareAtPrice) <= Number(v.basePrice)) local.compareAtPrice = 'Must be higher than the price';
    if (!variants.length) local.variants = 'Add at least one variant';
    setErrors(local);
    if (!Object.keys(local).length) save.mutate();
  };

  const cell = 'h-9 w-full min-w-0 rounded-sm border border-line bg-paper px-2 text-sm focus:border-ink focus:outline-none';

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        {save.isError && !Object.keys(errors).length && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        {save.isSuccess && product && <Alert tone="success">Saved.</Alert>}
        <Panel title="Details">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Product name" value={v.name} onChange={set('name')} required error={errors.name} className="sm:col-span-2" />
            <Field label="URL slug" value={v.slug} onChange={set('slug')} placeholder="Generated from the name" hint={v.slug ? `/p/${v.slug}` : undefined} error={errors.slug} />
            <Field label="Style code" value={product?.styleCode ?? ''} disabled hint={product ? 'Used to build variant SKUs' : 'Assigned automatically (VL-####)'} />
            <div className="sm:col-span-2"><TextArea label="Short description" value={v.shortDescription} onChange={set('shortDescription')} maxLength={500} rows={2} error={errors.shortDescription} /></div>
            <div className="sm:col-span-2"><TextArea label="Description" value={v.description} onChange={set('description')} rows={5} error={errors.description} /></div>
            <Field label="Material" value={v.material} onChange={set('material')} />
            <Field label="Care instructions" value={v.careInstructions} onChange={set('careInstructions')} />
            <Field label="Video URL (https)" value={v.videoUrl} onChange={set('videoUrl')} error={errors.videoUrl} />
            <Field label="Tags (comma separated)" value={v.tags} onChange={set('tags')} placeholder="wedding, linen" />
          </div>
        </Panel>

        <Panel title={`Images (${images.length})`} actions={
          <label className="cursor-pointer text-xs font-semibold underline">
            {upload.isPending ? 'Uploading…' : 'Upload images'}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={upload.isPending}
              onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) upload.mutate(fs); e.target.value = ''; }} />
          </label>
        }>
          {upload.isError && <div className="mb-4"><Alert tone="danger">{errorMessage(upload.error)}</Alert></div>}
          {images.length === 0 && <p className="mb-4 text-sm text-muted">Upload JPEG, PNG or WebP (max 5 MB each). The first image is the main product image. A product needs at least one image to go live.</p>}
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {images.map((im, i) => (
              <li key={im.key} className="rounded-sm border border-line p-2">
                <div className="relative aspect-[3/4] overflow-hidden rounded-sm bg-sand">
                  <img src={im.url} alt={im.alt} className="h-full w-full object-cover" />
                  {i === 0 && <span className="absolute left-1 top-1 rounded-sm bg-ink px-1.5 py-0.5 text-[10px] font-bold text-paper">MAIN</span>}
                </div>
                <select value={im.color} onChange={(e) => setImages(images.map((x) => (x.key === im.key ? { ...x, color: e.target.value } : x)))}
                  className="mt-2 h-8 w-full rounded-sm border border-line bg-paper px-1 text-xs" aria-label="Colourway">
                  <option value="">All colours</option>
                  {colorOptions.map((c) => <option key={c}>{c}</option>)}
                </select>
                <div className="mt-2 flex justify-between text-xs">
                  <span className="flex gap-2">
                    <button type="button" disabled={i === 0} onClick={() => moveImage(i, -1)} aria-label="Move left" className="disabled:opacity-30">←</button>
                    <button type="button" disabled={i === images.length - 1} onClick={() => moveImage(i, 1)} aria-label="Move right" className="disabled:opacity-30">→</button>
                  </span>
                  <button type="button" onClick={() => setImages(images.filter((x) => x.key !== im.key))} className="font-semibold text-danger">Remove</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="…or paste an image URL (https://)" className={cx(cell, 'h-10')} />
            <Button type="button" variant="secondary" size="sm" className="h-10" disabled={!/^https?:\/\/\S+$/.test(imageUrl)}
              onClick={() => { setImages([...images, { key: newKey(), url: imageUrl, color: '', alt: '' }]); setImageUrl(''); }}>Add</Button>
          </div>
        </Panel>

        <Panel title={`Variants (${variants.length})`}>
          {errors.variants && <div className="mb-4"><Alert tone="danger">{errors.variants}</Alert></div>}
          <div className="mb-5 grid gap-3 rounded-sm bg-ivory p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Colours" value={gen.colors} onChange={(e) => setGen({ ...gen, colors: e.target.value })} placeholder="Black, Ivory" />
            <Field label="Sizes" value={gen.sizes} onChange={(e) => setGen({ ...gen, sizes: e.target.value })} placeholder="S, M, L or One Size" />
            <Button type="button" variant="secondary" onClick={generate} disabled={!gen.colors.trim() && !gen.sizes.trim()} className="h-12">Add combinations</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-[0.1em] text-muted">
                {['Colour', 'Hex', 'Size', 'SKU', 'Price override', 'Compare-at', 'Cost', ...(warehouses.data ?? []).map((w) => `Stock ${w.code}`), 'Active', ''].map((h) => <th key={h} className="px-1.5 pb-2 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {variants.map((x) => {
                  const inv = product?.variants.find((pv) => pv.id === x.id)?.inventory ?? [];
                  return (
                    <tr key={x.key} className={cx(!x.isActive && 'opacity-50')}>
                      <td className="p-1.5"><input className={cell} value={x.color} onChange={(e) => updateVariant(x.key, { color: e.target.value })} aria-label="Colour" /></td>
                      <td className="p-1.5"><span className="flex items-center gap-1">
                        <input type="color" value={/^#[0-9a-f]{6}$/i.test(x.colorHex) ? x.colorHex : '#dddddd'} onChange={(e) => updateVariant(x.key, { colorHex: e.target.value.toUpperCase() })} className="h-9 w-9 shrink-0 cursor-pointer rounded-sm border border-line" aria-label="Colour swatch" />
                      </span></td>
                      <td className="p-1.5"><input className={cell} value={x.size} onChange={(e) => updateVariant(x.key, { size: e.target.value })} aria-label="Size" /></td>
                      <td className="p-1.5"><input className={cx(cell, 'font-mono text-xs')} value={x.sku} disabled={!!x.id} onChange={(e) => updateVariant(x.key, { sku: e.target.value.toUpperCase() })} placeholder="Auto" aria-label="SKU" /></td>
                      <td className="p-1.5"><input className={cell} inputMode="decimal" value={x.price} onChange={(e) => updateVariant(x.key, { price: e.target.value })} placeholder={v.basePrice || '—'} aria-label="Price override" /></td>
                      <td className="p-1.5"><input className={cell} inputMode="decimal" value={x.compareAtPrice} onChange={(e) => updateVariant(x.key, { compareAtPrice: e.target.value })} aria-label="Compare-at price" /></td>
                      <td className="p-1.5"><input className={cell} inputMode="decimal" value={x.costPrice} onChange={(e) => updateVariant(x.key, { costPrice: e.target.value })} aria-label="Cost price" /></td>
                      {(warehouses.data ?? []).map((w) => {
                        const row = inv.find((i) => i.warehouse.id === w.id);
                        return (
                          <td key={w.id} className="p-1.5">
                            {x.id ? <span className="block px-2 text-sm" title={`${row?.reserved ?? 0} reserved`}>{row?.onHand ?? 0}{row?.reserved ? <span className="text-xs text-muted"> ({row.reserved} res.)</span> : null}</span>
                              : <input className={cell} inputMode="numeric" value={x.stock[w.id] ?? ''} placeholder="0" aria-label={`Opening stock ${w.code}`}
                                onChange={(e) => updateVariant(x.key, { stock: { ...x.stock, [w.id]: e.target.value.replace(/\D/g, '') } })} />}
                          </td>
                        );
                      })}
                      <td className="p-1.5 text-center"><input type="checkbox" className="accent-ink" checked={x.isActive} onChange={(e) => updateVariant(x.key, { isActive: e.target.checked })} aria-label="Active" /></td>
                      <td className="p-1.5">
                        {!x.id && <button type="button" onClick={() => setVariants(variants.filter((y) => y.key !== x.key))} className="text-xs font-semibold text-danger">Remove</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {product && <p className="mt-3 text-xs text-muted">Stock for existing variants changes through Inventory (adjustments, transfers, purchase orders) so every unit is accounted for. Untick “Active” to stop selling a variant.</p>}
        </Panel>

        <Panel title="Attributes" actions={<button type="button" className="text-xs font-semibold underline" onClick={() => setAttributes([...attributes, { key: newKey(), name: '', value: '' }])}>Add attribute</button>}>
          {!attributes.length && <p className="text-sm text-muted">Specifications such as Origin, Fit or Lining appear on the product page.</p>}
          <div className="space-y-2">
            {attributes.map((a) => (
              <div key={a.key} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                <input className={cx(cell, 'h-10')} value={a.name} placeholder="Name" aria-label="Attribute name" onChange={(e) => setAttributes(attributes.map((x) => (x.key === a.key ? { ...x, name: e.target.value } : x)))} />
                <input className={cx(cell, 'h-10')} value={a.value} placeholder="Value" aria-label="Attribute value" onChange={(e) => setAttributes(attributes.map((x) => (x.key === a.key ? { ...x, value: e.target.value } : x)))} />
                <button type="button" className="px-2 text-xs font-semibold text-danger" onClick={() => setAttributes(attributes.filter((x) => x.key !== a.key))}>Remove</button>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel title="Publishing">
          <div className="space-y-4">
            <Select label="Status" value={v.status} onChange={set('status')}>
              <option value="DRAFT">Draft (hidden)</option>
              <option value="ACTIVE">Active (on sale)</option>
              <option value="ARCHIVED">Archived</option>
              {product?.status === 'PENDING_REVIEW' && <option value="PENDING_REVIEW">Awaiting review</option>}
            </Select>
            <Checkbox label="Feature on the homepage" checked={v.isFeatured} onChange={(e) => setV({ ...v, isFeatured: e.target.checked })} />
            <Button type="submit" block loading={save.isPending}>{product ? 'Save changes' : 'Create product'}</Button>
          </div>
        </Panel>
        <Panel title="Organisation">
          <div className="space-y-4">
            <Select label="Category" value={v.categoryId} onChange={set('categoryId')} aria-invalid={!!errors.categoryId}>
              <option value="">Choose a category</option>
              {flatCats.map((c) => <option key={c.id} value={c.id}>{'— '.repeat(c.depth)}{c.name}</option>)}
            </Select>
            {errors.categoryId && <p role="alert" className="-mt-2 text-[13px] text-danger">{errors.categoryId}</p>}
            <Select label="Brand" value={v.brandId} onChange={set('brandId')}>
              <option value="">No brand</option>
              {(brands.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
        </Panel>
        <Panel title="Pricing (GH₵)">
          <div className="space-y-4">
            <Field label="Price" inputMode="decimal" value={v.basePrice} onChange={set('basePrice')} placeholder="249.00" required error={errors.basePrice} />
            <Field label="Compare-at price" inputMode="decimal" value={v.compareAtPrice} onChange={set('compareAtPrice')} hint="Shows as a strike-through sale price" error={errors.compareAtPrice} />
          </div>
        </Panel>
      </div>
    </form>
  );
}
