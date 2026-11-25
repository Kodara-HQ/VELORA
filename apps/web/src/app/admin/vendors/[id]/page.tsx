'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Forbidden, KpiTile, PageHeader, Panel, QueryState, StatusPill, Table, Td, TextArea } from '@/components/admin/ui';
import { Dialog } from '@/components/dialog';
import { PAYOUT_METHOD } from '@/components/settlement-view';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';
import type { VendorStats } from '@/components/admin/types';

interface VendorDetail {
  id: number; businessName: string; slug: string; email: string; phone: string | null; description: string | null; status: string; commissionRate: string;
  payoutMethod: string | null; payoutDetails: { accountName?: string; number?: string; bankName?: string } | null; verifiedAt: string | null; createdAt: string;
  owner: { id: number; firstName: string; lastName: string; email: string; phone: string | null }; warehouses: Array<{ id: number; code: string; name: string }>;
  stats: { allTime: VendorStats; last90Days: VendorStats };
  settlements: Array<{ id: number; reference: string; status: string; netAmount: string; createdAt: string; paidAt: string | null }>;
  topProducts: Array<{ id: number; name: string; status: string; soldCount: number; avgRating: number; basePrice: string }>;
}

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const canView = useCan('vendors.view');
  const canManage = useCan('vendors.manage');
  const canSettle = useCan('settlements.manage');
  const [dialog, setDialog] = useState<'commission' | 'suspend' | null>(null);
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['admin-vendor', id], queryFn: () => api<VendorDetail>(`/admin/vendors/${id}`), enabled: canView });
  const update = useMutation({
    mutationFn: (body: object) => api<VendorDetail>(`/admin/vendors/${id}`, { method: 'PATCH', body }),
    onSuccess: (v) => { qc.setQueryData(['admin-vendor', id], v); qc.invalidateQueries({ queryKey: ['admin-vendors'] }); setDialog(null); },
  });
  const errs = update.error instanceof ApiError ? update.error.fieldErrors : {};
  if (!canView) return <Forbidden />;
  const v = q.data;
  const s90 = v?.stats.last90Days;
  const all = v?.stats.allTime;
  const rateOk = /^\d{1,2}(\.\d{1,2})?$/.test(rate) && Number(rate) <= 50;

  return (
    <>
      <PageHeader title={v?.businessName ?? 'Vendor'} back={{ href: '/admin/vendors', label: 'Vendors' }}
        description={v && <span className="flex flex-wrap items-center gap-2"><StatusPill status={v.status} /> {v.commissionRate}% commission · {v.status === 'ACTIVE' ? <a href={`/v/${v.slug}`} target="_blank" className="underline">/v/{v.slug} ↗</a> : `/v/${v.slug}`}</span>}
        actions={v && canManage && <>
          <Button variant="secondary" onClick={() => { update.reset(); setRate(v.commissionRate); setDialog('commission'); }}>Change commission</Button>
          {v.status === 'ACTIVE'
            ? <Button variant="danger" onClick={() => { update.reset(); setReason(''); setDialog('suspend'); }}>Suspend</Button>
            : <Button loading={update.isPending} onClick={() => update.mutate({ status: 'ACTIVE' })}>Reactivate</Button>}
        </>} />
      {update.isError && !dialog && <div className="mb-4"><Alert tone="danger">{errorMessage(update.error)}</Alert></div>}
      {v?.status === 'SUSPENDED' && <div className="mb-4"><Alert tone="warning" title="Suspended">This shop’s products are hidden from the store and the seller can’t use the portal.</Alert></div>}
      <QueryState q={q}>
        {v && s90 && all && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiTile label="Sales (90 days)" value={formatMoney(s90.grossSales)} hint={`${s90.orders} orders · all time ${formatMoney(all.grossSales)}`} />
              <KpiTile label="Return rate (90 days)" value={`${s90.returnRate}%`} hint={`${s90.returnedUnits} of ${s90.units} units`} />
              <KpiTile label="Rating" value={all.reviewCount ? `★ ${all.rating.toFixed(1)}` : '—'} hint={`${all.reviewCount} reviews`} />
              <KpiTile label="Owed to vendor" value={formatMoney(all.earnings.payable)} hint={`${formatMoney(all.earnings.onHold)} on hold · ${formatMoney(all.earnings.settled)} paid`} />
            </div>
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-6">
                <Panel title="Top products" padded={false} actions={<Link href={`/admin/products?owner=${v.id}`} className="text-xs font-semibold underline">All products ({all.products.active + all.products.pendingReview + all.products.draft + all.products.rejected})</Link>}>
                  <QueryState q={q} empty={!v.topProducts.length} emptyText="No products yet.">
                    <Table head={['Product', 'Status', 'Price', 'Sold', 'Rating']}>
                      {v.topProducts.map((p) => (
                        <tr key={p.id}>
                          <Td><Link href={`/admin/products/${p.id}`} className="font-medium hover:underline">{p.name}</Link></Td>
                          <Td><StatusPill status={p.status} /></Td>
                          <Td>{formatMoney(p.basePrice)}</Td>
                          <Td>{p.soldCount}</Td>
                          <Td>{p.avgRating ? p.avgRating.toFixed(1) : '—'}</Td>
                        </tr>
                      ))}
                    </Table>
                  </QueryState>
                </Panel>
                <Panel title="Settlements" padded={false} actions={canSettle && <Link href={`/admin/settlements?vendorId=${v.id}`} className="text-xs font-semibold underline">All</Link>}>
                  {!v.settlements.length ? <p className="px-5 py-8 text-center text-sm text-muted">No statements yet.</p> : (
                    <Table head={['Reference', 'Created', 'Status', 'Payout']}>
                      {v.settlements.map((st) => (
                        <tr key={st.id}>
                          <Td>{canSettle ? <Link href={`/admin/settlements/${st.id}`} className="font-medium hover:underline">{st.reference}</Link> : st.reference}</Td>
                          <Td className="text-muted">{new Date(st.createdAt).toLocaleDateString('en-GB')}</Td>
                          <Td><StatusPill status={st.status} /></Td>
                          <Td className="font-semibold">{formatMoney(st.netAmount)}</Td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </Panel>
              </div>
              <div className="space-y-6">
                <Panel title="Contact">
                  <dl className="space-y-2 text-sm">
                    <div><dt className="text-xs text-muted">Owner</dt><dd>{v.owner.firstName} {v.owner.lastName} · {v.owner.email}</dd></div>
                    <div><dt className="text-xs text-muted">Shop email / phone</dt><dd>{v.email}{v.phone && ` · ${v.phone}`}</dd></div>
                    <div><dt className="text-xs text-muted">Approved</dt><dd>{v.verifiedAt ? new Date(v.verifiedAt).toLocaleDateString('en-GB') : '—'}</dd></div>
                    <div><dt className="text-xs text-muted">Stock location</dt><dd>{v.warehouses.map((w) => w.code).join(', ') || '—'}</dd></div>
                  </dl>
                </Panel>
                <Panel title="Payout details">
                  {v.payoutMethod && v.payoutDetails
                    ? <p className="text-sm">{PAYOUT_METHOD[v.payoutMethod] ?? v.payoutMethod}<br />{v.payoutDetails.accountName}<br /><span className="font-mono">{v.payoutDetails.bankName ? `${v.payoutDetails.bankName} · ` : ''}{v.payoutDetails.number}</span></p>
                    : <p className="text-sm text-danger">Not set. The vendor adds these in their portal.</p>}
                </Panel>
                {v.description && <Panel title="About"><p className="whitespace-pre-line text-sm text-muted">{v.description}</p></Panel>}
              </div>
            </div>
          </div>
        )}
      </QueryState>

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} label={dialog === 'commission' ? 'Change commission' : 'Suspend vendor'} className="max-w-md">
        <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); update.mutate(dialog === 'commission' ? { commissionRate: Number(rate) } : { status: 'SUSPENDED', reason }); }}>
          <h2 className="text-xl font-extrabold">{dialog === 'commission' ? 'Change commission' : `Suspend ${v?.businessName}`}</h2>
          {update.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
          {dialog === 'commission' ? <>
            <p className="text-sm text-muted">Applies to new orders only. Existing earnings keep the rate they were sold at. The vendor is notified.</p>
            <Field label="Commission (%)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} error={errs.commissionRate ?? (rateOk ? undefined : 'Enter 0–50')} />
          </> : <>
            <p className="text-sm text-muted">Hides all their products from the store and locks the vendor portal straight away. Open orders are unaffected. The vendor sees your reason.</p>
            <TextArea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} error={errs.reason} />
          </>}
          <div className="flex gap-2">
            <Button type="submit" variant={dialog === 'suspend' ? 'danger' : 'primary'} loading={update.isPending} disabled={dialog === 'commission' ? !rateOk : reason.trim().length < 3}>
              {dialog === 'commission' ? 'Save rate' : 'Suspend vendor'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
