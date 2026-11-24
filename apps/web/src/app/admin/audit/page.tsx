'use client';

import { useQuery } from '@tanstack/react-query';
import { Fragment, Suspense, useState } from 'react';
import { PageHeader, Pager, Panel, QueryState, SearchInput, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';
import { formatDateTime } from '@/lib/format';

interface Entry { id: number; action: string; entityType: string; entityId: string | null; oldValues: unknown; newValues: unknown; ipAddress: string | null; createdAt: string; user: { email: string; firstName: string; lastName: string } | null }

function Inner() {
  const f = useUrlFilters();
  const [open, setOpen] = useState<number | null>(null);
  const query = { action: f.get('action'), entityType: f.get('entityType'), entityId: f.get('entityId'), page: f.get('page') || 1, pageSize: 50 };
  const q = useQuery({ queryKey: ['admin-audit', query], queryFn: () => apiWithMeta<Entry[]>(`/audit-logs${qs(query)}`), placeholderData: (p) => p });
  return (
    <>
      <PageHeader title="Audit log" description="Every privileged action, who did it, from where, and what changed. Secrets are redacted." />
      <div className="mb-4 flex flex-wrap gap-2">
        <SearchInput value={f.get('action')} onChange={(v) => f.set('action', v)} placeholder="Action starts with (e.g. orders.)" />
        <SearchInput value={f.get('entityType')} onChange={(v) => f.set('entityType', v)} placeholder="Entity type (e.g. product)" />
        <SearchInput value={f.get('entityId')} onChange={(v) => f.set('entityId', v)} placeholder="Entity id / order number" />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No entries match.">
          <Table head={['When', 'Who', 'Action', 'Entity', 'IP', '']}>
            {q.data?.data.map((e) => (
              <Fragment key={e.id}>
                <tr>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(e.createdAt)}</Td>
                  <Td>{e.user ? `${e.user.firstName} ${e.user.lastName}` : 'System'}<span className="block text-xs text-muted">{e.user?.email}</span></Td>
                  <Td className="font-mono text-xs">{e.action}</Td>
                  <Td>{e.entityType}{e.entityId && <span className="text-muted"> #{e.entityId}</span>}</Td>
                  <Td className="text-xs text-muted">{e.ipAddress}</Td>
                  <Td>{(e.oldValues || e.newValues) ? <button type="button" className="text-xs font-semibold underline" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? 'Hide' : 'Changes'}</button> : null}</Td>
                </tr>
                {open === e.id && (
                  <tr><td colSpan={6} className="bg-ivory px-4 py-3">
                    <div className="grid gap-4 text-xs md:grid-cols-2">
                      <div><p className="mb-1 font-semibold">Before</p><pre className="overflow-x-auto whitespace-pre-wrap rounded-sm bg-paper p-2">{JSON.stringify(e.oldValues, null, 2) ?? '—'}</pre></div>
                      <div><p className="mb-1 font-semibold">After</p><pre className="overflow-x-auto whitespace-pre-wrap rounded-sm bg-paper p-2">{JSON.stringify(e.newValues, null, 2) ?? '—'}</pre></div>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function AuditPage() {
  return <Suspense><Inner /></Suspense>;
}
