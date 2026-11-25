'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Forbidden, PageHeader, QueryState } from '@/components/admin/ui';
import { Dialog } from '@/components/dialog';
import { SettlementView, type SettlementDetail } from '@/components/settlement-view';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

export default function AdminSettlementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const can = useCan('settlements.manage');
  const [paying, setPaying] = useState(false);
  const [ref, setRef] = useState('');
  const q = useQuery({ queryKey: ['admin-settlement', id], queryFn: () => api<SettlementDetail>(`/admin/settlements/${id}`), enabled: can });
  const act = useMutation({
    mutationFn: (a: 'approve' | 'pay' | 'cancel') => api<SettlementDetail | { cancelled: true }>(`/admin/settlements/${id}/${a}`, { method: 'POST', body: a === 'pay' ? { payoutReference: ref.trim() } : {} }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admin-settlements'] });
      qc.invalidateQueries({ queryKey: ['admin-payable'] });
      if ('cancelled' in r) return router.replace('/admin/settlements');
      qc.setQueryData(['admin-settlement', id], r);
      setPaying(false);
    },
  });
  const errs = act.error instanceof ApiError ? act.error.fieldErrors : {};
  if (!can) return <Forbidden />;
  const s = q.data;
  const pd = s?.vendor.payoutDetails;

  return (
    <>
      <PageHeader title={s ? `Statement ${s.reference}` : 'Statement'} back={{ href: '/admin/settlements', label: 'Settlements' }}
        description={s && <Link href={`/admin/vendors/${s.vendor.id}`} className="underline">{s.vendor.businessName}</Link>}
        actions={s && <>
          {s.status === 'DRAFT' && <Button loading={act.isPending && act.variables === 'approve'} onClick={() => act.mutate('approve')}>Approve</Button>}
          {s.status === 'APPROVED' && <Button disabled={!s.vendor.payoutMethod || !pd} onClick={() => { act.reset(); setRef(''); setPaying(true); }}>Record payment</Button>}
          {(s.status === 'DRAFT' || s.status === 'APPROVED') && (
            <Button variant="secondary" loading={act.isPending && act.variables === 'cancel'}
              onClick={() => window.confirm(`Cancel ${s.reference}? Its ${s.commissions.length} sales go back to “ready to settle”.`) && act.mutate('cancel')}>Cancel statement</Button>
          )}
        </>} />
      {act.isError && !paying && <div className="mb-4"><Alert tone="danger">{errorMessage(act.error)}</Alert></div>}
      {s?.status === 'APPROVED' && (!s.vendor.payoutMethod || !pd) && <div className="mb-4"><Alert tone="warning">The vendor hasn’t added payout details yet, so payment can’t be recorded.</Alert></div>}
      <QueryState q={q}>{s && <SettlementView s={s} orderHref={(n) => `/admin/orders/${n}`} />}</QueryState>

      <Dialog open={paying} onClose={() => setPaying(false)} label="Record payment" className="max-w-md">
        <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); act.mutate('pay'); }}>
          <h2 className="text-xl font-extrabold">Record payment</h2>
          {s && <p className="text-sm text-muted">Send <b className="text-ink">{formatMoney(s.netAmount)}</b> to {pd?.accountName} ({pd?.number}), then enter the MoMo or bank transfer reference. This marks the statement paid and notifies the vendor; it can’t be undone.</p>}
          {act.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(act.error)}</Alert>}
          <Field label="Transfer reference" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. MP241125.1432.A12345" error={errs.payoutReference} />
          <div className="flex gap-2">
            <Button type="submit" loading={act.isPending} disabled={ref.trim().length < 4}>Mark as paid</Button>
            <Button type="button" variant="ghost" onClick={() => setPaying(false)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
