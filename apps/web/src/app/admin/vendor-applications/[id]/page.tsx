'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Forbidden, PageHeader, Panel, QueryState, StatusPill, TextArea } from '@/components/admin/ui';
import { Dialog } from '@/components/dialog';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';
import type { VendorApplication } from '@/components/admin/types';

export default function VendorApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const canView = useCan('vendors.view');
  const canDecide = useCan('vendors.approve');
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const [notes, setNotes] = useState('');
  const [rate, setRate] = useState('15');
  const [approved, setApproved] = useState<{ id: number; slug: string } | null>(null);
  const q = useQuery({ queryKey: ['admin-vendor-application', id], queryFn: () => api<VendorApplication>(`/admin/vendor-applications/${id}`), enabled: canView });
  const act = useMutation({
    mutationFn: (a: 'review' | 'approve' | 'reject') => api<VendorApplication | { application: VendorApplication; vendor: { id: number; slug: string } }>(`/admin/vendor-applications/${id}/${a}`, {
      method: 'POST', body: a === 'approve' ? { notes: notes || undefined, commissionRate: Number(rate) } : a === 'reject' ? { notes } : {},
    }),
    onSuccess: (r) => {
      if ('application' in r) { qc.setQueryData(['admin-vendor-application', id], r.application); setApproved(r.vendor); }
      else qc.setQueryData(['admin-vendor-application', id], r);
      qc.invalidateQueries({ queryKey: ['admin-vendor-applications'] });
      qc.invalidateQueries({ queryKey: ['admin-notifications'] });
      setDialog(null);
    },
  });
  const errs = act.error instanceof ApiError ? act.error.fieldErrors : {};
  if (!canView) return <Forbidden />;
  const a = q.data;
  const open = a && (a.status === 'SUBMITTED' || a.status === 'UNDER_REVIEW');
  const rateOk = /^\d{1,2}(\.\d{1,2})?$/.test(rate) && Number(rate) <= 50;

  return (
    <>
      <PageHeader title={a?.businessName ?? 'Application'} back={{ href: '/admin/vendor-applications', label: 'Vendor applications' }}
        description={a && <span className="flex items-center gap-2"><StatusPill status={a.status === 'SUBMITTED' ? 'PENDING' : a.status} /> Submitted {new Date(a.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
        actions={open && canDecide && <>
          {a.status === 'SUBMITTED' && <Button variant="secondary" loading={act.isPending && act.variables === 'review'} onClick={() => act.mutate('review')}>Start review</Button>}
          <Button onClick={() => { act.reset(); setNotes(''); setDialog('approve'); }}>Approve</Button>
          <Button variant="danger" onClick={() => { act.reset(); setNotes(''); setDialog('reject'); }}>Reject</Button>
        </>} />
      {approved && <div className="mb-4"><Alert tone="success" title="Vendor approved">The shop, its stock location and the seller’s portal access were created. <Link href={`/admin/vendors/${approved.id}`} className="font-semibold underline">Open vendor</Link></Alert></div>}
      {act.isError && !dialog && <div className="mb-4"><Alert tone="danger">{errorMessage(act.error)}</Alert></div>}
      <QueryState q={q}>
        {a && (
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Business">
              <dl className="grid grid-cols-[160px_1fr] gap-y-2.5 text-sm">
                <dt className="text-muted">Name</dt><dd className="font-semibold">{a.businessName}</dd>
                <dt className="text-muted">Registration no.</dt><dd>{a.registrationNumber ?? '—'}</dd>
                <dt className="text-muted">TIN / Ghana Card</dt><dd>{a.taxId ?? '—'}</dd>
                <dt className="text-muted">Phone</dt><dd>{a.contactPhone}</dd>
                <dt className="text-muted">Address</dt><dd>{a.businessAddress}</dd>
                <dt className="text-muted">Sells</dt><dd>{(a.productCategories ?? []).join(', ') || '—'}</dd>
                <dt className="text-muted">About</dt><dd className="whitespace-pre-line">{a.documents?.about ?? '—'}</dd>
              </dl>
            </Panel>
            <div className="space-y-6">
              <Panel title="Applicant">
                <dl className="grid grid-cols-[160px_1fr] gap-y-2.5 text-sm">
                  <dt className="text-muted">Name</dt><dd>{a.user.firstName} {a.user.lastName}</dd>
                  <dt className="text-muted">Email</dt><dd>{a.user.email}</dd>
                  <dt className="text-muted">Phone</dt><dd>{a.user.phone ?? '—'}</dd>
                  <dt className="text-muted">Customer since</dt><dd>{new Date(a.user.createdAt).toLocaleDateString('en-GB')}{a.user.customer ? ` · ${a.user.customer.orderCount} orders` : ''}</dd>
                </dl>
              </Panel>
              {(a.reviewedBy || a.reviewNotes) && (
                <Panel title="Decision">
                  <p className="text-sm">{a.reviewedBy && <>By {a.reviewedBy.firstName} {a.reviewedBy.lastName}{a.reviewedAt && ` on ${new Date(a.reviewedAt).toLocaleDateString('en-GB')}`}</>}</p>
                  {a.reviewNotes && <p className="mt-2 whitespace-pre-line text-sm text-muted">{a.reviewNotes}</p>}
                </Panel>
              )}
            </div>
          </div>
        )}
      </QueryState>

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} label={dialog === 'approve' ? 'Approve vendor' : 'Reject application'} className="max-w-md">
        <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); if (dialog) act.mutate(dialog); }}>
          <h2 className="text-xl font-extrabold">{dialog === 'approve' ? `Approve ${a?.businessName}` : 'Reject this application'}</h2>
          {act.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(act.error)}</Alert>}
          {dialog === 'approve' ? <>
            <p className="text-sm text-muted">Creates the shop, a stock location and seller access for {a?.user.email}. They’re notified straight away.</p>
            <Field label="Commission (%)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} error={errs.commissionRate ?? (rateOk ? undefined : 'Enter 0–50')} />
            <TextArea label="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </> : <>
            <p className="text-sm text-muted">The applicant sees your reason and can apply again.</p>
            <TextArea label="Reason" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} error={errs.notes} placeholder="e.g. We couldn’t verify the registration number" />
          </>}
          <div className="flex gap-2">
            <Button type="submit" variant={dialog === 'reject' ? 'danger' : 'primary'} loading={act.isPending} disabled={dialog === 'approve' ? !rateOk : notes.trim().length < 5}>
              {dialog === 'approve' ? 'Approve and create shop' : 'Reject'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
