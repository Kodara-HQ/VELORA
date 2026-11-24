'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { normalisePhone } from '@/components/address-form';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Skeleton } from '@/components/ui';
import { api, ApiError, type SessionPayload } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface Overview {
  profile: { firstName: string; lastName: string; email: string; phone: string | null; marketingOptIn: boolean; referralCode: string | null; memberSince: string };
  loyalty: { pointsBalance: number; lifetimePoints: number; tier: string };
  counts: { orders: number; wishlist: number; addresses: number };
}
interface LoginEvent { id: number; success: boolean; ipAddress: string | null; createdAt: string }

export default function AccountOverviewPage() {
  const { user, signIn, signOutLocal } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<'one' | 'all' | null>(null);
  const overview = useQuery({ queryKey: ['overview', user?.id], queryFn: () => api<Overview>('/me/overview') });
  const activity = useQuery({ queryKey: ['login-activity', user?.id], queryFn: () => api<LoginEvent[]>('/auth/login-activity') });

  async function signOut(all: boolean) {
    setBusy(all ? 'all' : 'one');
    try {
      await api(all ? '/auth/logout-all' : '/auth/logout', { method: 'POST', body: {} });
    } finally {
      signOutLocal();
      router.replace('/login');
    }
  }

  const o = overview.data;
  return (
    <div className="space-y-6">
      {overview.isPending ? <Skeleton className="h-32" /> : overview.isError ? <Alert tone="danger">{errorMessage(overview.error)}</Alert> : o && (
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-sm bg-ink p-5 text-paper sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-paper/60">VÉLORA Rewards · {o.loyalty.tier.toLowerCase()}</p>
            <p className="mt-2 font-display text-4xl font-extrabold">{o.loyalty.pointsBalance.toLocaleString()} <span className="text-base font-medium text-paper/70">points</span></p>
            <p className="mt-1 text-sm text-paper/70">Earn 1 point per GH₵1 once your orders are delivered.</p>
          </div>
          <Stat label="Orders" value={o.counts.orders} href="/account/orders" />
          <Stat label="Wishlist" value={o.counts.wishlist} href="/account/wishlist" />
        </div>
      )}

      {o && <ProfileForm overview={o} />}

      <Card className="p-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em]">Change password</h2>
        <ChangePassword onChanged={signIn} />
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em]">Recent sign-ins</h2>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={busy === 'one'} onClick={() => signOut(false)}>Sign out</Button>
            <Button variant="ghost" size="sm" loading={busy === 'all'} onClick={() => signOut(true)}>Sign out everywhere</Button>
          </div>
        </div>
        {activity.isPending ? <Skeleton className="mt-5 h-24" /> : activity.isError ? <div className="mt-5"><Alert tone="danger">{errorMessage(activity.error)}</Alert></div>
          : !activity.data.length ? <EmptyState title="No sign-ins yet" /> : (
            <ul className="mt-4 divide-y divide-line text-sm">
              {activity.data.slice(0, 6).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="flex items-center gap-3"><Badge tone={a.success ? 'success' : 'danger'}>{a.success ? 'Success' : 'Failed'}</Badge><span className="text-muted">{a.ipAddress ?? 'Unknown IP'}</span></span>
                  <span className="text-muted">{formatDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
      </Card>
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-sm border border-line bg-paper p-5 hover:border-ink">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">{label}</p>
      <p className="mt-2 font-display text-4xl font-extrabold">{value}</p>
    </Link>
  );
}

function ProfileForm({ overview }: { overview: Overview }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ firstName: '', lastName: '', phone: '', marketingOptIn: false });
  useEffect(() => {
    const p = overview.profile;
    setV({ firstName: p.firstName, lastName: p.lastName, phone: p.phone ?? '', marketingOptIn: p.marketingOptIn });
  }, [overview.profile]);
  const m = useMutation({
    mutationFn: () => api<Overview>('/me/profile', { method: 'PATCH', body: { firstName: v.firstName, lastName: v.lastName, marketingOptIn: v.marketingOptIn, ...(v.phone.trim() && { phone: normalisePhone(v.phone) }) } }),
    onSuccess: (data) => qc.setQueryData(['overview'], data),
  });
  const errs = m.error instanceof ApiError ? m.error.fieldErrors : {};
  const onSubmit = (e: FormEvent) => { e.preventDefault(); m.mutate(); };

  return (
    <Card className="p-6">
      <h2 className="text-sm font-bold uppercase tracking-[0.15em]">Profile</h2>
      <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-5 sm:grid-cols-2">
        {m.isSuccess && <div className="sm:col-span-2"><Alert tone="success">Profile saved.</Alert></div>}
        {m.isError && !Object.keys(errs).length && <div className="sm:col-span-2"><Alert tone="danger">{errorMessage(m.error)}</Alert></div>}
        <Field label="First name" value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} required error={errs.firstName} />
        <Field label="Last name" value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} required error={errs.lastName} />
        <Field label="Email" value={overview.profile.email} disabled hint="Contact customer care to change your email." />
        <Field label="Mobile number" type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="024 123 4567" error={errs.phone} />
        <div className="sm:col-span-2"><Checkbox label="Email me new arrivals and member offers" checked={v.marketingOptIn} onChange={(e) => setV({ ...v, marketingOptIn: e.target.checked })} /></div>
        <div className="sm:col-span-2"><Button type="submit" loading={m.isPending}>Save profile</Button></div>
      </form>
    </Card>
  );
}

function ChangePassword({ onChanged }: { onChanged: (p: SessionPayload) => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setLoading(true);
    setErrors({});
    setMessage(null);
    try {
      onChanged(await api<SessionPayload>('/auth/change-password', { method: 'POST', body: { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') } }));
      form.reset();
      setMessage({ tone: 'success', text: 'Password updated. Other devices have been signed out.' });
    } catch (err) {
      const e2 = err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Something went wrong.');
      setErrors(e2.fieldErrors);
      setMessage({ tone: 'danger', text: e2.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-5 grid gap-5 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
      {message && <div className="sm:col-span-3"><Alert tone={message.tone}>{message.text}</Alert></div>}
      <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" required error={errors.currentPassword} />
      <Field label="New password" name="newPassword" type="password" autoComplete="new-password" required hint="10+ characters, a letter and a number." error={errors.newPassword} />
      <Button type="submit" loading={loading} className="sm:mt-[22px]">Update</Button>
    </form>
  );
}
