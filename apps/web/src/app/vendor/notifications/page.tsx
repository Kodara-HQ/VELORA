'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageHeader, Pager, Panel, QueryState } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { timeAgo, useNotificationActions, type AppNotification } from '@/components/notification-bell';
import { Button } from '@/components/ui';
import { apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';
import { cx } from '@/lib/cx';

function NotificationsInner() {
  const f = useUrlFilters();
  const query = { unread: f.get('unread') || undefined, page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['notifications', 'page', query], queryFn: () => apiWithMeta<AppNotification[]>(`/me/notifications${qs(query)}`), placeholderData: (p) => p });
  const { read, readAll } = useNotificationActions();
  return (
    <>
      <PageHeader title="Notifications" actions={<>
        <Button variant="secondary" onClick={() => f.set('unread', f.get('unread') ? '' : 'true')}>{f.get('unread') ? 'Show all' : 'Unread only'}</Button>
        <Button variant="secondary" loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all read</Button>
      </>} />
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText={f.get('unread') ? 'No unread notifications.' : 'Nothing yet.'}>
          <ul className="divide-y divide-line">
            {q.data?.data.map((x) => (
              <li key={x.id} className={cx('flex items-start gap-4 px-5 py-4', !x.readAt && 'bg-ivory')}>
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', x.readAt ? 'bg-transparent' : 'bg-rose-deep')} aria-hidden="true" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className={cx(!x.readAt && 'font-semibold')}>{x.title}{!x.readAt && <span className="sr-only"> (unread)</span>}</p>
                  <p className="mt-0.5 text-muted">{x.body}</p>
                  <p className="mt-1 text-xs text-muted">{timeAgo(x.createdAt)}</p>
                </div>
                <div className="flex shrink-0 gap-3 text-xs font-semibold">
                  {x.data?.href && <Link href={x.data.href} onClick={() => !x.readAt && read.mutate(x.id)} className="underline">Open</Link>}
                  {!x.readAt && <button type="button" className="underline" onClick={() => read.mutate(x.id)}>Mark read</button>}
                </div>
              </li>
            ))}
          </ul>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function VendorNotificationsPage() {
  return <Suspense><NotificationsInner /></Suspense>;
}
