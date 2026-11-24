'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Container, EmptyState, Field, Skeleton } from '@/components/ui';
import { api, ApiError, type SessionPayload } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

interface LoginEvent { id: number; success: boolean; reason: string | null; ipAddress: string | null; userAgent: string | null; createdAt: string }

export default function AccountPage() {
  const router = useRouter();
  const { status, user, signIn, signOutLocal } = useSession();
  const [busy, setBusy] = useState<'one' | 'all' | null>(null);

  // UI redirect only; every API call below is independently protected by the server.
  useEffect(() => {
    if (status === 'anonymous') router.replace('/login?next=/account');
  }, [status, router]);

  const activity = useQuery({
    queryKey: ['login-activity', user?.id],
    queryFn: () => api<LoginEvent[]>('/auth/login-activity'),
    enabled: status === 'authenticated',
  });

  async function signOut(all: boolean) {
    setBusy(all ? 'all' : 'one');
    try {
      await api(all ? '/auth/logout-all' : '/auth/logout', { method: 'POST', body: {} });
    } finally {
      signOutLocal();
      router.replace('/login');
    }
  }

  if (status !== 'authenticated' || !user) {
    return (
      <Container className="py-12">
        <Skeleton className="h-10 w-64" />
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-56" /><Skeleton className="h-56 lg:col-span-2" />
        </div>
      </Container>
    );
  }

  return (
    <Container className="py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-deep">My account</p>
      <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">Hello, {user.firstName}.</h1>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <Card className="p-6">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em]">Profile</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <div><dt className="text-muted">Name</dt><dd className="font-medium">{user.firstName} {user.lastName}</dd></div>
            <div><dt className="text-muted">Email</dt><dd className="font-medium break-all">{user.email}</dd></div>
            <div><dt className="text-muted">Mobile</dt><dd className="font-medium">{user.phone ?? 'Not added'}</dd></div>
            <div>
              <dt className="text-muted">Access</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {user.roles.map((r) => <Badge key={r} tone={r === 'customer' ? 'neutral' : 'ink'}>{r.replace(/_/g, ' ')}</Badge>)}
              </dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-col gap-2">
            <Button variant="secondary" block loading={busy === 'one'} onClick={() => signOut(false)}>Sign out</Button>
            <Button variant="ghost" block loading={busy === 'all'} onClick={() => signOut(true)}>Sign out of all devices</Button>
          </div>
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em]">Recent sign-ins</h2>
          {activity.isPending ? (
            <div className="mt-5 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : activity.isError ? (
            <div className="mt-5"><Alert tone="danger">{(activity.error as Error).message}</Alert></div>
          ) : activity.data.length === 0 ? (
            <EmptyState title="No sign-ins yet" body="Your recent sign-in history will appear here." />
          ) : (
            <ul className="mt-5 divide-y divide-line text-sm">
              {activity.data.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="flex items-center gap-3">
                    <Badge tone={a.success ? 'success' : 'danger'}>{a.success ? 'Success' : 'Failed'}</Badge>
                    <span className="text-muted">{a.ipAddress ?? 'Unknown IP'}</span>
                  </span>
                  <span className="text-muted">{formatDateTime(a.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6 lg:col-span-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.15em]">Change password</h2>
          <ChangePassword onChanged={signIn} />
        </Card>
      </div>
    </Container>
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
      onChanged(await api<SessionPayload>('/auth/change-password', {
        method: 'POST', body: { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') },
      }));
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
      <Field label="New password" name="newPassword" type="password" autoComplete="new-password" required
        hint="10+ characters, a letter and a number." error={errors.newPassword} />
      <Button type="submit" loading={loading} className="sm:mt-[22px]">Update</Button>
    </form>
  );
}
