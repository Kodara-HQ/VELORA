'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import { Forbidden, PageHeader, Pager, Panel, QueryState, SearchInput, StatusPill, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { ButtonLink } from '@/components/ui';
import { apiWithMeta } from '@/lib/api';
import { qs } from '@/lib/admin';
import { cx } from '@/lib/cx';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';

interface Row { id: number; name: string; slug: string; type: string; value: string | null; state: string; startsAt: string; endsAt: string; productCount: number; unitsSold: number; revenue: string; orders: number }
const TABS: Array<[string, string]> = [['', 'All'], ['live', 'Live'], ['scheduled', 'Scheduled'], ['paused', 'Paused'], ['ended', 'Ended']];
const TYPE: Record<string, string> = { FLASH_SALE: 'Flash sale', PERCENTAGE_OFF: '% off', FIXED_AMOUNT_OFF: 'GH₵ off' };
const when = (s: string) => new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Inner() {
  const f = useUrlFilters();
  const can = useCan('promotions.manage');
  const query = { status: f.get('status'), q: f.get('q'), page: f.get('page') || 1, pageSize: 25 };
  const q = useQuery({ queryKey: ['admin-promotions', query], queryFn: () => apiWithMeta<Row[]>(`/admin/promotions${qs(query)}`), enabled: can, placeholderData: (p) => p });
  if (!can) return <Forbidden />;
  return (
    <>
      <PageHeader title="Promotions" description="Flash sales and price promotions. Prices change in the store the moment a promotion starts or ends."
        actions={<ButtonLink href="/admin/promotions/new">New promotion</ButtonLink>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Promotion status" className="flex flex-wrap gap-1.5">
          {TABS.map(([v, l]) => (
            <button key={v} type="button" aria-pressed={f.get('status') === v} onClick={() => f.set('status', v)}
              className={cx('rounded-full border px-3.5 py-1.5 text-sm', f.get('status') === v ? 'border-ink bg-ink text-paper' : 'border-line bg-paper hover:border-ink')}>{l}</button>
          ))}
        </nav>
        <SearchInput value={f.get('q')} onChange={(v) => f.set('q', v)} placeholder="Name or campaign" />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.data.length} emptyText="No promotions here yet.">
          <Table head={['Promotion', 'Status', 'Offer', 'Runs', 'Products', 'Units sold', 'Revenue']}>
            {q.data?.data.map((p) => (
              <tr key={p.id} className="hover:bg-ivory">
                <Td><Link href={`/admin/promotions/${p.id}`} className="font-semibold hover:underline">{p.name}</Link></Td>
                <Td><StatusPill status={p.state} /></Td>
                <Td>{TYPE[p.type]}{p.value && <span className="text-muted"> · {p.type === 'FIXED_AMOUNT_OFF' ? formatMoney(p.value) : `${Number(p.value)}%`}</span>}</Td>
                <Td className="whitespace-nowrap text-muted">{when(p.startsAt)} – {when(p.endsAt)}</Td>
                <Td>{p.productCount}</Td>
                <Td>{p.unitsSold}</Td>
                <Td>{formatMoney(p.revenue)}</Td>
              </tr>
            ))}
          </Table>
          <Pager meta={q.data?.meta} onPage={(n) => f.set('page', String(n))} />
        </QueryState>
      </Panel>
    </>
  );
}

export default function PromotionsPage() {
  return <Suspense><Inner /></Suspense>;
}
