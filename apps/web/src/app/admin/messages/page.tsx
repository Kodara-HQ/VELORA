'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import { FilterSelect, Forbidden, PageHeader, Pager, Panel, QueryState, Select, StatusPill, Table, TextArea, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { qs } from '@/lib/admin';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';
import type { PaginationMeta } from '@velora/shared';

interface Msg { id: number; channel: 'EMAIL' | 'SMS'; recipient: string; template: string; subject: string | null; status: string; attempts: number; lastError: string | null; sentAt: string | null; createdAt: string }
interface Outbox { items: Msg[]; meta: PaginationMeta; counts: Record<string, number> }
const PILL: Record<string, string> = { PENDING: 'PENDING', SENT: 'SUCCESS', FAILED: 'FAILED', SKIPPED: 'ARCHIVED' };

function Inner() {
  const f = useUrlFilters();
  const qc = useQueryClient();
  const can = useCan('notifications.send');
  const query = { status: f.get('status'), channel: f.get('channel'), q: f.get('q'), page: f.get('page') || 1, pageSize: 30 };
  const q = useQuery({ queryKey: ['admin-outbox', query], queryFn: () => api<Outbox>(`/admin/messages${qs(query)}`), enabled: can, placeholderData: (p) => p, refetchInterval: 15_000 });
  const flush = useMutation({ mutationFn: () => api<{ sent: number; failed: number }>('/admin/messages/flush', { method: 'POST', body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-outbox'] }) });
  const retry = useMutation({ mutationFn: (id: number) => api(`/admin/messages/${id}/retry`, { method: 'POST', body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-outbox'] }) });
  if (!can) return <Forbidden />;
  const c = q.data?.counts ?? {};
  return (
    <>
      <PageHeader title="Messages" description="Every email and SMS VÉLORA sends. Messages are queued with the action that caused them and delivered within a minute, with automatic retries."
        actions={<Button variant="secondary" loading={flush.isPending} onClick={() => flush.mutate()}>Send queued now</Button>} />
      {flush.isSuccess && <div className="mb-4"><Alert tone="success">Sent {flush.data.sent}{flush.data.failed ? `, ${flush.data.failed} failed (will retry)` : ''}.</Alert></div>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap gap-2">
            <FilterSelect label="Status" value={f.get('status')} onChange={(v) => f.set('status', v)}
              options={[['', `All (${Object.values(c).reduce((a, b) => a + b, 0)})`], ['PENDING', `Queued (${c.PENDING ?? 0})`], ['SENT', `Sent (${c.SENT ?? 0})`], ['FAILED', `Failed (${c.FAILED ?? 0})`]]} />
            <FilterSelect label="Channel" value={f.get('channel')} onChange={(v) => f.set('channel', v)} options={[['', 'Email and SMS'], ['EMAIL', 'Email'], ['SMS', 'SMS']]} />
          </div>
          <Panel padded={false}>
            <QueryState q={q} empty={!q.data?.items.length} emptyText="No messages yet.">
              <Table head={['Message', 'To', 'Status', 'Attempts', 'Queued', '']}>
                {q.data?.items.map((m) => (
                  <tr key={m.id}>
                    <Td><span className="text-xs font-semibold uppercase tracking-wider text-muted">{m.channel}</span> <span className="block">{m.subject ?? m.template}</span>{m.lastError && <span className="block max-w-xs truncate text-xs text-danger" title={m.lastError}>{m.lastError}</span>}</Td>
                    <Td className="font-mono text-xs">{m.recipient}</Td>
                    <Td><StatusPill status={PILL[m.status] ?? m.status} /></Td>
                    <Td>{m.attempts}</Td>
                    <Td className="whitespace-nowrap text-muted">{new Date(m.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Td>
                    <Td>{m.status === 'FAILED' && <Button size="sm" variant="secondary" loading={retry.isPending && retry.variables === m.id} onClick={() => retry.mutate(m.id)}>Retry</Button>}</Td>
                  </tr>
                ))}
              </Table>
              <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
            </QueryState>
          </Panel>
        </div>
        <Broadcast />
      </div>
    </>
  );
}

function Broadcast() {
  const qc = useQueryClient();
  const [v, setV] = useState({ channel: 'EMAIL', audience: 'all', subject: '', body: '' });
  const payload = { channel: v.channel, audience: v.audience, subject: v.channel === 'EMAIL' ? v.subject : undefined, body: v.body };
  const count = useMutation({ mutationFn: () => api<{ recipients: number }>('/admin/messages/broadcast', { method: 'POST', body: { ...payload, dryRun: true } }) });
  const send = useMutation({
    mutationFn: () => api<{ queued: number }>('/admin/messages/broadcast', { method: 'POST', body: payload }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-outbox'] }); setV({ ...v, subject: '', body: '' }); count.reset(); },
  });
  const errs = send.error instanceof ApiError ? send.error.fieldErrors : {};
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => { setV({ ...v, [k]: e.target.value }); count.reset(); };
  const ready = v.body.trim().length >= 10 && (v.channel === 'SMS' || v.subject.trim());
  return (
    <Panel title="Send a campaign" className="h-fit">
      <div className="space-y-4">
        <p className="text-xs text-muted">Goes only to customers who opted in to marketing on that channel.</p>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Channel" value={v.channel} onChange={set('channel')}><option value="EMAIL">Email</option><option value="SMS">SMS</option></Select>
          <Select label="Audience" value={v.audience} onChange={set('audience')}>
            <option value="all">All opted-in</option><option value="BRONZE">Bronze</option><option value="SILVER">Silver</option><option value="GOLD">Gold</option><option value="PLATINUM">Platinum</option>
          </Select>
        </div>
        {v.channel === 'EMAIL' && <Field label="Subject" value={v.subject} onChange={set('subject')} maxLength={150} error={errs.subject} />}
        <TextArea label={v.channel === 'SMS' ? `Message (${v.body.length}/160)` : 'Message'} value={v.body} onChange={set('body')} rows={5} maxLength={1000} error={errs.body} />
        {send.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(send.error)}</Alert>}
        {send.isSuccess && <Alert tone="success">Queued for {send.data.queued} customers.</Alert>}
        {count.isSuccess && <p className="text-sm">This will reach <b>{count.data.recipients}</b> customer{count.data.recipients === 1 ? '' : 's'}.</p>}
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!ready} loading={count.isPending} onClick={() => count.mutate()}>Count recipients</Button>
          <Button disabled={!ready || !count.isSuccess || !count.data.recipients} loading={send.isPending}
            onClick={() => window.confirm(`Send this ${v.channel === 'SMS' ? 'SMS' : 'email'} to ${count.data?.recipients} customers?`) && send.mutate()}>Send</Button>
        </div>
      </div>
    </Panel>
  );
}

export default function MessagesPage() {
  return <Suspense><Inner /></Suspense>;
}
