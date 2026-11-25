'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';

export interface AppNotification { id: number; type: string; title: string; body: string; data: { href?: string } | null; readAt: string | null; createdAt: string }

export const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

export function useNotificationActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: (id: number) => api(`/me/notifications/${id}/read`, { method: 'POST', body: {} }), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api('/me/notifications/read-all', { method: 'POST', body: {} }), onSuccess: refresh });
  return { read, readAll };
}

/** In-app notifications for the signed-in user (vendor portal header). */
export function NotificationBell({ allHref }: { allHref: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api<{ count: number }>('/me/notifications/unread-count'), refetchInterval: 60_000 });
  const list = useQuery({ queryKey: ['notifications', 'recent'], queryFn: () => api<AppNotification[]>('/me/notifications?pageSize=6'), enabled: open });
  const { read, readAll } = useNotificationActions();
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const n = count.data?.count ?? 0;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Notifications, ${n} unread`}
        className="relative flex h-10 w-10 items-center justify-center rounded-full hover:bg-sand">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {n > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-deep px-1 text-[10px] font-bold text-paper">{n > 9 ? '9+' : n}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-[min(22rem,calc(100vw-2rem))] rounded-md border border-line bg-paper shadow-xl animate-fade-up">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-bold">Notifications</p>
            {n > 0 && <button type="button" className="text-xs font-semibold underline" onClick={() => readAll.mutate()}>Mark all read</button>}
          </div>
          {list.isPending ? <p className="px-4 py-6 text-center text-sm text-muted">Loading…</p>
            : !list.data?.length ? <p className="px-4 py-6 text-center text-sm text-muted">Nothing yet.</p> : (
              <ul className="max-h-96 divide-y divide-line overflow-y-auto">
                {list.data.map((x) => (
                  <li key={x.id}>
                    <Link href={x.data?.href ?? allHref} onClick={() => { setOpen(false); if (!x.readAt) read.mutate(x.id); }}
                      className={cx('block px-4 py-3 text-sm hover:bg-sand', !x.readAt && 'bg-ivory')}>
                      <span className="flex items-start justify-between gap-2">
                        <span className={cx(!x.readAt && 'font-semibold')}>{x.title}</span>
                        {!x.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-deep" aria-label="Unread" />}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">{x.body}</span>
                      <span className="mt-1 block text-[11px] text-muted">{timeAgo(x.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          <Link href={allHref} onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-xs font-semibold hover:bg-sand">See all</Link>
        </div>
      )}
    </div>
  );
}
