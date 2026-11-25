'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useState, type FormEvent } from 'react';
import { FilterSelect, Forbidden, PageHeader, Pager, Panel, QueryState, SearchInput, Select, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { Dialog } from '@/components/dialog';
import { Alert, Button, Checkbox, Field } from '@/components/ui';
import { api, apiWithMeta, ApiError } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface Coupon {
  id: number; code: string; description: string | null; type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING'; value: string; minOrderAmount: string | null; maxDiscountAmount: string | null;
  usageLimit: number | null; usageLimitPerUser: number | null; usedCount: number; firstOrderOnly: boolean; startsAt: string | null; endsAt: string | null; isActive: boolean;
  redemptions: number; discountGiven: string; state: string;
}
const offer = (c: Coupon) => (c.type === 'FREE_SHIPPING' ? 'Free delivery' : c.type === 'PERCENTAGE' ? `${Number(c.value)}% off${c.maxDiscountAmount ? ` (max ${formatMoney(c.maxDiscountAmount)})` : ''}` : `${formatMoney(c.value)} off`);

function Inner() {
  const f = useUrlFilters();
  const can = useCan('coupons.manage');
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const query = { q: f.get('q'), status: f.get('status'), page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['admin-coupons', query], queryFn: () => apiWithMeta<Coupon[]>(`/admin/coupons${qs(query)}`), enabled: can, placeholderData: (p) => p });
  if (!can) return <Forbidden />;
  return (
    <>
      <PageHeader title="Coupons" description="Codes shoppers enter in their bag. Every rule is checked again when the order is placed." actions={<Button onClick={() => setEditing('new')}>New coupon</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Search codes" />
        <FilterSelect label="Status" value={f.get('status')} onChange={(v) => f.set('status', v)} options={[['', 'All'], ['active', 'Active'], ['inactive', 'Inactive'], ['expired', 'Expired']]} />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No coupons match.">
          <Table head={['Code', 'Offer', 'Rules', 'Used', 'Discount given', 'Status', '']}>
            {q.data?.data.map((c) => (
              <tr key={c.id}>
                <Td><span className="font-mono font-semibold">{c.code}</span>{c.description && <span className="block text-xs text-muted">{c.description}</span>}</Td>
                <Td>{offer(c)}</Td>
                <Td className="text-xs text-muted">{[c.minOrderAmount && `min ${formatMoney(c.minOrderAmount)}`, c.firstOrderOnly && 'first order', c.usageLimitPerUser && `${c.usageLimitPerUser}/customer`, c.endsAt && `until ${new Date(c.endsAt).toLocaleDateString('en-GB')}`].filter(Boolean).join(' · ') || '—'}</Td>
                <Td>{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}</Td>
                <Td>{formatMoney(c.discountGiven)}</Td>
                <Td><StatusPill status={c.state} /></Td>
                <Td><Button size="sm" variant="secondary" onClick={() => setEditing(c)}>Edit</Button></Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
      {editing && <CouponDialog coupon={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

function CouponDialog({ coupon, onClose }: { coupon: Coupon | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    code: coupon?.code ?? '', description: coupon?.description ?? '', type: coupon?.type ?? 'PERCENTAGE', value: coupon ? String(Number(coupon.value)) : '10',
    minOrderAmount: coupon?.minOrderAmount ?? '', maxDiscountAmount: coupon?.maxDiscountAmount ?? '', usageLimit: coupon?.usageLimit ? String(coupon.usageLimit) : '',
    usageLimitPerUser: coupon ? (coupon.usageLimitPerUser ? String(coupon.usageLimitPerUser) : '') : '1', firstOrderOnly: coupon?.firstOrderOnly ?? false,
    startsAt: day(coupon?.startsAt ?? null), endsAt: day(coupon?.endsAt ?? null), isActive: coupon?.isActive ?? true,
  });
  const num = (s: string) => (s.trim() ? Number(s) : null);
  const m = useMutation({
    mutationFn: () => {
      const body = {
        code: v.code, description: v.description || undefined, type: v.type, value: v.type === 'FREE_SHIPPING' ? 0 : Number(v.value),
        minOrderAmount: num(v.minOrderAmount), maxDiscountAmount: num(v.maxDiscountAmount), usageLimit: num(v.usageLimit), usageLimitPerUser: num(v.usageLimitPerUser),
        firstOrderOnly: v.firstOrderOnly, isActive: v.isActive,
        startsAt: v.startsAt ? new Date(`${v.startsAt}T00:00:00`).toISOString() : null, endsAt: v.endsAt ? new Date(`${v.endsAt}T23:59:59`).toISOString() : null,
      };
      return coupon ? api(`/admin/coupons/${coupon.id}`, { method: 'PATCH', body }) : api('/admin/coupons', { method: 'POST', body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-coupons'] }); onClose(); },
  });
  const errs = m.error instanceof ApiError ? m.error.fieldErrors : {};
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const onSubmit = (e: FormEvent) => { e.preventDefault(); m.mutate(); };
  return (
    <Dialog open onClose={onClose} label={coupon ? `Edit ${coupon.code}` : 'New coupon'} className="max-w-lg">
      <form onSubmit={onSubmit} noValidate className="max-h-[85vh] space-y-4 overflow-y-auto p-6">
        <h2 className="text-xl font-extrabold">{coupon ? `Edit ${coupon.code}` : 'New coupon'}</h2>
        {m.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(m.error)}</Alert>}
        <Field label="Code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} error={errs.code} hint={coupon?.usedCount ? 'Used codes can’t be renamed' : 'Letters, numbers, - or _'} disabled={!!coupon?.usedCount} />
        <Field label="Description (internal)" value={v.description} onChange={set('description')} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Type" value={v.type} onChange={set('type')}>
            <option value="PERCENTAGE">Percent off</option><option value="FIXED_AMOUNT">Amount off</option><option value="FREE_SHIPPING">Free delivery</option>
          </Select>
          {v.type !== 'FREE_SHIPPING' && <Field label={v.type === 'PERCENTAGE' ? 'Percent' : 'GH₵ off'} inputMode="decimal" value={v.value} onChange={set('value')} error={errs.value} />}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum spend (GH₵)" inputMode="decimal" value={v.minOrderAmount} onChange={set('minOrderAmount')} />
          {v.type === 'PERCENTAGE' && <Field label="Max discount (GH₵)" inputMode="decimal" value={v.maxDiscountAmount} onChange={set('maxDiscountAmount')} />}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total uses" inputMode="numeric" value={v.usageLimit} onChange={set('usageLimit')} hint="Empty = unlimited" />
          <Field label="Uses per customer" inputMode="numeric" value={v.usageLimitPerUser} onChange={set('usageLimitPerUser')} hint="Empty = unlimited" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts" type="date" value={v.startsAt} onChange={set('startsAt')} />
          <Field label="Ends" type="date" value={v.endsAt} onChange={set('endsAt')} error={errs.endsAt} />
        </div>
        <Checkbox label="First order only" checked={v.firstOrderOnly} onChange={(e) => setV({ ...v, firstOrderOnly: e.target.checked })} />
        <Checkbox label="Active" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
        <div className="flex gap-2">
          <Button type="submit" loading={m.isPending} disabled={v.code.length < 3}>{coupon ? 'Save' : 'Create coupon'}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function CouponsPage() {
  return <Suspense><Inner /></Suspense>;
}
