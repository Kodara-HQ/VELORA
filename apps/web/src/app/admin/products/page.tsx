'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useState } from 'react';
import { FilterSelect, PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill, Table, Td } from '@/components/admin/ui';
import { Dialog } from '@/components/dialog';
import { Alert, Button, ButtonLink } from '@/components/ui';
import { apiWithMeta } from '@/lib/api';
import { downloadFile, qs, uploadFiles } from '@/lib/admin';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';
import { useCategories } from '@/components/site-chrome';

interface Row {
  id: number; name: string; slug: string; styleCode: string; status: string; price: string; compareAtPrice: string | null; soldCount: number;
  category: string; brand: string | null; vendor: string | null; image: string | null; variantCount: number; onHand: number; available: number; updatedAt: string;
}
interface ImportResult { dryRun: boolean; products: number; created: number; updated: number; errors: Array<{ row: number; message: string }> }

function useUrlFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string) => params.get(k) ?? '';
  const set = useCallback((k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v); else p.delete(k);
    if (k !== 'page') p.delete('page');
    router.replace(`${pathname}?${p}`, { scroll: false });
  }, [params, router, pathname]);
  return { get, set };
}

function ProductsInner() {
  const f = useUrlFilters();
  const canCreate = useCan('products.create');
  const canImport = useCan('products.create', 'products.update');
  const cats = useCategories();
  const [importOpen, setImportOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const query = { q: f.get('q'), status: f.get('status'), categoryId: f.get('categoryId'), stock: f.get('stock'), owner: f.get('owner'), sort: f.get('sort') || 'updated', page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['admin-products', query], queryFn: () => apiWithMeta<Row[]>(`/admin/products${qs(query)}`), placeholderData: (p) => p });

  return (
    <>
      <PageHeader title="Products" description="Catalogue, pricing and stock at a glance."
        actions={<>
          <Button variant="secondary" onClick={() => downloadFile('/admin/products/export.csv', 'products.csv').catch((e) => setExportError(errorMessage(e)))}>Export CSV</Button>
          {canImport && <Button variant="secondary" onClick={() => setImportOpen(true)}>Import CSV</Button>}
          {canCreate && <ButtonLink href="/admin/products/new">Add product</ButtonLink>}
        </>} />
      {exportError && <div className="mb-4"><Alert tone="danger">{exportError}</Alert></div>}
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Search name, style code or SKU" />
        <FilterSelect label="Status" value={f.get('status')} onChange={(v) => f.set('status', v)}
          options={[['', 'All statuses'], ['ACTIVE', 'Active'], ['DRAFT', 'Draft'], ['PENDING_REVIEW', 'Awaiting review'], ['ARCHIVED', 'Archived'], ['REJECTED', 'Rejected']]} />
        <FilterSelect label="Department" value={f.get('categoryId')} onChange={(v) => f.set('categoryId', v)} options={[['', 'All departments'], ...(cats.data ?? []).map((c) => [String(c.id), c.name] as [string, string])]} />
        <FilterSelect label="Stock" value={f.get('stock')} onChange={(v) => f.set('stock', v)} options={[['', 'Any stock'], ['low', 'Low stock'], ['out', 'Out of stock']]} />
        <FilterSelect label="Owner" value={f.get('owner')} onChange={(v) => f.set('owner', v)} options={[['', 'All sellers'], ['platform', 'VÉLORA stock']]} />
        <FilterSelect label="Sort" value={f.get('sort') || 'updated'} onChange={(v) => f.set('sort', v)} options={[['updated', 'Recently updated'], ['name', 'Name A–Z'], ['sold', 'Best selling'], ['price', 'Price']]} />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No products match these filters.">
          <Table head={['Product', 'Status', 'Price', 'Stock', 'Variants', 'Sold', 'Seller']}>
            {q.data?.data.map((p) => (
              <tr key={p.id} className="hover:bg-ivory">
                <Td>
                  <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3">
                    <span className="h-12 w-9 shrink-0 overflow-hidden rounded-sm bg-sand">
                      {p.image && <img src={p.image} alt="" className="h-full w-full object-cover" loading="lazy" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold hover:underline">{p.name}</span>
                      <span className="text-xs text-muted">{p.styleCode} · {p.category}{p.brand && ` · ${p.brand}`}</span>
                    </span>
                  </Link>
                </Td>
                <Td><StatusPill status={p.status} /></Td>
                <Td className="whitespace-nowrap">{formatMoney(p.price)}{p.compareAtPrice && <s className="ml-1.5 text-xs text-muted">{formatMoney(p.compareAtPrice)}</s>}</Td>
                <Td><span className={p.available <= 0 ? 'font-semibold text-danger' : p.available < 10 ? 'font-semibold text-warning' : undefined}>{p.available}</span><span className="text-xs text-muted"> / {p.onHand}</span></Td>
                <Td>{p.variantCount}</Td>
                <Td>{p.soldCount}</Td>
                <Td className="text-muted">{p.vendor ?? 'VÉLORA'}</Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={() => void q.refetch()} />
    </>
  );
}

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => uploadFiles<ImportResult>(`/admin/products/import?dryRun=${dryRun}`, 'file', file!),
    onSuccess: (r) => { if (!r.dryRun) onDone(); },
  });
  const r = run.data;
  return (
    <Dialog open={open} onClose={() => { onClose(); run.reset(); setFile(null); }} label="Import products" className="max-w-lg">
      <div className="p-6 sm:p-8">
        <h2 className="text-xl font-extrabold">Import products from CSV</h2>
        <p className="mt-2 text-sm text-muted">Use the export format. Products are matched by <b>style_code</b> and variants by <b>sku</b>. Stock levels are not imported: use purchase orders or adjustments so the stock ledger stays accurate.</p>
        <input type="file" accept=".csv,text/csv" className="mt-5 block w-full text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); run.reset(); }} />
        {run.isError && <div className="mt-4"><Alert tone="danger">{errorMessage(run.error)}</Alert></div>}
        {r && (
          <div className="mt-4 space-y-2">
            <Alert tone={r.errors.length ? 'warning' : 'success'} title={r.dryRun ? 'Check complete (nothing saved yet)' : 'Import complete'}>
              {r.products} product(s): {r.created} new, {r.updated} updated{r.errors.length ? `, ${r.errors.length} row(s) with problems` : ''}.
            </Alert>
            {r.errors.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-sm border border-line bg-ivory p-3 text-xs">
                {r.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" disabled={!file} loading={run.isPending && run.variables} onClick={() => run.mutate(true)}>Check file</Button>
          <Button disabled={!file || !r?.dryRun} loading={run.isPending && !run.variables} onClick={() => run.mutate(false)}>Import</Button>
        </div>
      </div>
    </Dialog>
  );
}

export default function ProductsPage() {
  return <Suspense><ProductsInner /></Suspense>;
}
