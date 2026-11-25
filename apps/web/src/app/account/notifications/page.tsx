'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { timeAgo, useNotificationActions, type AppNotification } from '@/components/notification-bell';
import { Alert, Button, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { errorMessage } from '@/lib/shop';

interface Prefs { email: { orders: boolean; marketing: boolean }; sms: { orders: boolean; marketing: boolean } }

export default function NotificationsPage() {
  const list = useQuery({ queryKey: ['notifications', 'account'], queryFn: () => api<AppNotification[]>('/me/notifications?pageSize=30') });
  const { read, readAll } = useNotificationActions();
  return (
    <div className="space-y-10">
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <h1 className="text-3xl font-extrabold">Notifications</h1>
          {list.data?.some((n) => !n.readAt) && <Button size="sm" variant="secondary" loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all read</Button>}
        </div>
        {list.isPending ? <Skeleton className="h-40" /> : list.isError ? <Alert tone="danger">{errorMessage(list.error)}</Alert> : !list.data.length ? (
          <p className="text-sm text-muted">Nothing yet. Order updates, rewards and replies will appear here.</p>
        ) : (
          <ul className="divide-y divide-line rounded-sm border border-line bg-paper">
            {list.data.map((n) => (
              <li key={n.id} className={cx('flex gap-3 px-4 py-3 text-sm', !n.readAt && 'bg-ivory')}>
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-rose-deep')} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className={cx(!n.readAt && 'font-semibold')}>{n.title}</p>
                  <p className="text-muted">{n.body}</p>
                  <p className="mt-1 text-xs text-muted">{timeAgo(n.createdAt)}</p>
                </div>
                {n.data?.href && <Link href={n.data.href} onClick={() => !n.readAt && read.mutate(n.id)} className="shrink-0 self-center text-xs font-semibold underline">View</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Preferences />
    </div>
  );
}

function Preferences() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api<Prefs>('/me/notification-preferences') });
  const [p, setP] = useState<Prefs | null>(null);
  useEffect(() => { if (q.data) setP(q.data); }, [q.data]);
  const save = useMutation({ mutationFn: (body: Prefs) => api<Prefs>('/me/notification-preferences', { method: 'PUT', body }), onSuccess: (d) => qc.setQueryData(['notification-prefs'], d) });
  if (!p) return <Skeleton className="h-40" />;
  const toggle = (ch: 'email' | 'sms', k: 'orders' | 'marketing') => {
    const next = { ...p, [ch]: { ...p[ch], [k]: !p[ch][k] } };
    setP(next);
    save.mutate(next);
  };
  const rows: Array<['orders' | 'marketing', string, string]> = [
    ['orders', 'Order updates', 'Confirmation, dispatch, delivery and refunds'],
    ['marketing', 'Offers and new arrivals', 'Sales, flash sales and member-only offers'],
  ];
  return (
    <section>
      <h2 className="mb-1 text-lg font-extrabold">How we contact you</h2>
      <p className="mb-4 text-sm text-muted">In-app notifications are always on. Choose what else you’d like to receive.</p>
      {save.isError && <div className="mb-3"><Alert tone="danger">{errorMessage(save.error)}</Alert></div>}
      <table className="w-full max-w-xl text-sm">
        <thead><tr className="text-left text-[11px] uppercase tracking-[0.1em] text-muted"><th className="py-2 font-semibold">Message</th><th className="w-20 py-2 text-center font-semibold">Email</th><th className="w-20 py-2 text-center font-semibold">SMS</th></tr></thead>
        <tbody className="divide-y divide-line border-t border-line">
          {rows.map(([k, label, hint]) => (
            <tr key={k}>
              <td className="py-3"><span className="font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></td>
              {(['email', 'sms'] as const).map((ch) => (
                <td key={ch} className="text-center">
                  <input type="checkbox" className="h-4 w-4 accent-ink" checked={p[ch][k]} onChange={() => toggle(ch, k)} aria-label={`${label} by ${ch === 'sms' ? 'SMS' : 'email'}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {save.isSuccess && <p className="mt-2 text-xs text-success" role="status">Saved.</p>}
    </section>
  );
}
