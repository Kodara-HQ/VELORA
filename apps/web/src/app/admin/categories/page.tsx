'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { flattenCategories, type AdminCategory } from '@/components/admin/product-form';
import { PageHeader, Panel, QueryState, Select } from '@/components/admin/ui';
import { Dialog } from '@/components/dialog';
import { Alert, Badge, Button, Checkbox, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface Brand { id: number; name: string; slug: string; logoUrl: string | null; description: string | null; isFeatured: boolean; productCount: number }

export default function CategoriesPage() {
  const qc = useQueryClient();
  const canCats = useCan('categories.manage');
  const canBrands = useCan('brands.manage');
  const cats = useQuery({ queryKey: ['admin-categories'], queryFn: () => api<AdminCategory[]>('/admin/categories') });
  const brands = useQuery({ queryKey: ['admin-brands'], queryFn: () => api<Brand[]>('/admin/brands') });
  const [editCat, setEditCat] = useState<Partial<AdminCategory> | null>(null);
  const [editBrand, setEditBrand] = useState<Partial<Brand> | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['admin-categories'] }); void qc.invalidateQueries({ queryKey: ['categories'] }); };

  const reorder = useMutation({
    mutationFn: (items: Array<{ id: number; parentId: number | null; sortOrder: number }>) => api<AdminCategory[]>('/admin/categories/reorder', { method: 'PUT', body: { items } }),
    onSuccess: (tree) => { qc.setQueryData(['admin-categories'], tree); refresh(); },
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/admin/categories/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const delBrand = useMutation({
    mutationFn: (id: number) => api(`/admin/brands/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-brands'] }),
  });

  const move = (siblings: AdminCategory[], index: number, dir: -1 | 1) => {
    const list = [...siblings];
    [list[index], list[index + dir]] = [list[index + dir], list[index]];
    reorder.mutate(list.map((c, i) => ({ id: c.id, parentId: c.parentId, sortOrder: i })));
  };

  const renderTree = (nodes: AdminCategory[], depth = 0) => (
    <ul className={depth ? 'ml-6 border-l border-line pl-4' : ''}>
      {nodes.map((c, i) => (
        <li key={c.id}>
          <div className="group flex items-center gap-3 border-b border-line py-2.5 text-sm">
            <span className={depth ? '' : 'font-semibold'}>{c.name}</span>
            {!c.isActive && <Badge tone="outline">Hidden</Badge>}
            <span className="text-xs text-muted">{c.productCount} product{c.productCount === 1 ? '' : 's'} · /c/{c.slug}</span>
            {canCats && (
              <span className="ml-auto flex items-center gap-3 text-xs font-semibold">
                <button type="button" disabled={i === 0 || reorder.isPending} onClick={() => move(nodes, i, -1)} aria-label={`Move ${c.name} up`} className="disabled:opacity-30">↑</button>
                <button type="button" disabled={i === nodes.length - 1 || reorder.isPending} onClick={() => move(nodes, i, 1)} aria-label={`Move ${c.name} down`} className="disabled:opacity-30">↓</button>
                {depth === 0 && <button type="button" className="underline" onClick={() => setEditCat({ parentId: c.id, isActive: true })}>Add sub-category</button>}
                <button type="button" className="underline" onClick={() => setEditCat(c)}>Edit</button>
                <button type="button" className="text-danger underline" onClick={() => window.confirm(`Delete “${c.name}”?`) && del.mutate(c.id)}>Delete</button>
              </span>
            )}
          </div>
          {c.children.length > 0 && renderTree(c.children, depth + 1)}
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <PageHeader title="Categories & brands" description="Changes appear in the store navigation within a minute." />
      {(del.isError || reorder.isError || delBrand.isError) && <div className="mb-4"><Alert tone="danger">{errorMessage(del.error ?? reorder.error ?? delBrand.error)}</Alert></div>}
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Category tree" actions={canCats && <Button size="sm" onClick={() => setEditCat({ parentId: null, isActive: true })}>Add department</Button>}>
          <QueryState q={cats}>{cats.data && renderTree(cats.data)}</QueryState>
        </Panel>
        <Panel title={`Brands (${brands.data?.length ?? 0})`} padded={false} actions={canBrands && <Button size="sm" onClick={() => setEditBrand({ isFeatured: false })}>Add brand</Button>}>
          <QueryState q={brands} empty={!brands.data?.length}>
            <ul className="divide-y divide-line">
              {brands.data?.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="font-semibold">{b.name}</span>
                  {b.isFeatured && <Badge tone="rose">Featured</Badge>}
                  <span className="text-xs text-muted">{b.productCount} products</span>
                  {canBrands && <span className="ml-auto flex gap-3 text-xs font-semibold">
                    <button type="button" className="underline" onClick={() => setEditBrand(b)}>Edit</button>
                    <button type="button" className="text-danger underline" onClick={() => window.confirm(`Delete brand “${b.name}”?`) && delBrand.mutate(b.id)}>Delete</button>
                  </span>}
                </li>
              ))}
            </ul>
          </QueryState>
        </Panel>
      </div>
      {editCat && <CategoryDialog value={editCat} tree={cats.data ?? []} onClose={() => setEditCat(null)} onSaved={() => { setEditCat(null); refresh(); }} />}
      {editBrand && <BrandDialog value={editBrand} onClose={() => setEditBrand(null)} onSaved={() => { setEditBrand(null); void qc.invalidateQueries({ queryKey: ['admin-brands'] }); }} />}
    </>
  );
}

function CategoryDialog({ value, tree, onClose, onSaved }: { value: Partial<AdminCategory>; tree: AdminCategory[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: value.name ?? '', slug: value.slug ?? '', parentId: value.parentId ? String(value.parentId) : '', isActive: value.isActive ?? true });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: v.name, slug: v.slug || undefined, parentId: v.parentId ? Number(v.parentId) : null, isActive: v.isActive };
      return value.id ? api(`/admin/categories/${value.id}`, { method: 'PATCH', body }) : api('/admin/categories', { method: 'POST', body });
    },
    onSuccess: onSaved,
  });
  const errs = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const options = flattenCategories(tree).filter((c) => c.id !== value.id && c.depth === 0);
  return (
    <Dialog open onClose={onClose} label={value.id ? 'Edit category' : 'New category'} className="max-w-md">
      <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2 className="text-xl font-extrabold">{value.id ? 'Edit category' : 'New category'}</h2>
        {save.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <Field label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required error={errs.name} />
        <Field label="URL slug" value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value })} hint="Leave blank to generate" error={errs.slug} />
        <Select label="Parent" value={v.parentId} onChange={(e) => setV({ ...v, parentId: e.target.value })}>
          <option value="">None (top-level department)</option>
          {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Checkbox label="Visible in the store" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
        <div className="flex gap-2 pt-2"><Button type="submit" loading={save.isPending}>Save</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}

function BrandDialog({ value, onClose, onSaved }: { value: Partial<Brand>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: value.name ?? '', description: value.description ?? '', logoUrl: value.logoUrl ?? '', isFeatured: value.isFeatured ?? false });
  const save = useMutation({
    mutationFn: () => value.id ? api(`/admin/brands/${value.id}`, { method: 'PATCH', body: v }) : api('/admin/brands', { method: 'POST', body: v }),
    onSuccess: onSaved,
  });
  const errs = save.error instanceof ApiError ? save.error.fieldErrors : {};
  return (
    <Dialog open onClose={onClose} label={value.id ? 'Edit brand' : 'New brand'} className="max-w-md">
      <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2 className="text-xl font-extrabold">{value.id ? 'Edit brand' : 'New brand'}</h2>
        {save.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        <Field label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required error={errs.name} />
        <Field label="Logo URL (optional)" value={v.logoUrl} onChange={(e) => setV({ ...v, logoUrl: e.target.value })} error={errs.logoUrl} />
        <Field label="Description (optional)" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        <Checkbox label="Feature on the homepage" checked={v.isFeatured} onChange={(e) => setV({ ...v, isFeatured: e.target.checked })} />
        <div className="flex gap-2 pt-2"><Button type="submit" loading={save.isPending}>Save</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Dialog>
  );
}
