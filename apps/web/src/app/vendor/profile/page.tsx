'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { PageHeader, Panel, QueryState, Select, TextArea } from '@/components/admin/ui';
import { PAYOUT_METHOD } from '@/components/settlement-view';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/shop';

interface Profile {
  businessName: string; slug: string; email: string; phone: string | null; description: string | null; logoUrl: string | null; commissionRate: string;
  payoutMethod: string | null; payoutDetails: { accountName?: string; number?: string; bankName?: string } | null; verifiedAt: string | null;
}

export default function VendorProfilePage() {
  const q = useQuery({ queryKey: ['vendor-profile'], queryFn: () => api<Profile>('/vendor/profile') });
  return (
    <>
      <PageHeader title="Shop profile" description={q.data && <>Your public shop: <a href={`/v/${q.data.slug}`} target="_blank" className="underline">/v/{q.data.slug}</a> · {q.data.commissionRate}% commission</>} />
      <QueryState q={q}>{q.data && <ProfileForm p={q.data} />}</QueryState>
    </>
  );
}

function ProfileForm({ p }: { p: Profile }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ description: p.description ?? '', logoUrl: p.logoUrl ?? '', phone: p.phone ?? '' });
  const [pay, setPay] = useState({ method: p.payoutMethod ?? '', accountName: p.payoutDetails?.accountName ?? '', number: p.payoutDetails?.number ?? '', bankName: p.payoutDetails?.bankName ?? '' });
  const save = useMutation({
    mutationFn: (body: object) => api<Profile>('/vendor/profile', { method: 'PATCH', body }),
    onSuccess: (np) => qc.setQueryData(['vendor-profile'], np),
  });
  const errs = save.error instanceof ApiError ? save.error.fieldErrors : {};
  const payoutChanged = pay.method !== (p.payoutMethod ?? '') || pay.accountName !== (p.payoutDetails?.accountName ?? '') || pay.number !== (p.payoutDetails?.number ?? '') || pay.bankName !== (p.payoutDetails?.bankName ?? '');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      description: v.description, logoUrl: v.logoUrl || undefined, phone: v.phone || undefined,
      ...(payoutChanged && pay.method && { payoutMethod: pay.method, payoutDetails: { accountName: pay.accountName, number: pay.number.replace(/\s/g, ''), bankName: pay.method === 'BANK' ? pay.bankName : undefined } }),
    });
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid max-w-4xl gap-6 lg:grid-cols-2">
      <div className="lg:col-span-2">
        {save.isSuccess && <Alert tone="success">Saved.</Alert>}
        {save.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
      </div>
      <Panel title="About your shop">
        <div className="space-y-4">
          <Field label="Shop name" value={p.businessName} disabled hint="Contact VÉLORA to change your registered name" />
          <TextArea label="Description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} rows={4} maxLength={2000} error={errs.description} />
          <Field label="Logo URL (optional)" value={v.logoUrl} onChange={(e) => setV({ ...v, logoUrl: e.target.value })} placeholder="https://…" error={errs.logoUrl} />
          <Field label="Business phone" type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} error={errs.phone} />
          <Field label="Email" value={p.email} disabled />
        </div>
      </Panel>
      <Panel title="Payouts">
        <div className="space-y-4">
          <p className="text-sm text-muted">Where we send your earnings. Changes are recorded for security.</p>
          <Select label="Method" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
            <option value="">Choose…</option>
            {Object.entries(PAYOUT_METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
          {pay.method && <>
            <Field label="Account name" value={pay.accountName} onChange={(e) => setPay({ ...pay, accountName: e.target.value })} error={errs['payoutDetails.accountName']} />
            {pay.method === 'BANK' && <Field label="Bank" value={pay.bankName} onChange={(e) => setPay({ ...pay, bankName: e.target.value })} placeholder="e.g. GCB Bank" error={errs['payoutDetails.bankName']} />}
            <Field label={pay.method === 'BANK' ? 'Account number' : 'MoMo number'} inputMode="tel" value={pay.number} onChange={(e) => setPay({ ...pay, number: e.target.value })}
              placeholder={pay.method === 'BANK' ? '1234567890123' : '+233241234567'} error={errs['payoutDetails.number']} />
          </>}
        </div>
      </Panel>
      <div className="lg:col-span-2"><Button type="submit" loading={save.isPending}>Save profile</Button></div>
    </form>
  );
}
