'use client';

import { useQuery } from '@tanstack/react-query';
import { Suspense, useState } from 'react';
import { FilterSelect, PageHeader, Panel, QueryState, Table, Td } from '@/components/admin/ui';
import { useUrlFilters } from '@/components/admin/use-url-filters';
import { Alert, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { daysAgo, downloadFile, isoDay, qs } from '@/lib/admin';
import { formatMoney } from '@/lib/format';
import { errorMessage } from '@/lib/shop';

interface Report { groupBy: string; rows: Array<{ period: string; orders: number; units: number; returned: number; gross: string; commission: string; net: string }> }

function ReportsInner() {
  const f = useUrlFilters();
  const [err, setErr] = useState<string | null>(null);
  const from = f.get('from') || daysAgo(89);
  const to = f.get('to') || isoDay(new Date());
  const groupBy = f.get('groupBy') || 'week';
  const query = { from, to, groupBy };
  const q = useQuery({ queryKey: ['vendor-report', query], queryFn: () => api<Report>(`/vendor/reports/sales${qs(query)}`), placeholderData: (p) => p });
  const rows = q.data?.rows ?? [];
  const total = (k: 'orders' | 'units' | 'returned') => rows.reduce((s, r) => s + r[k], 0);
  const money = (k: 'gross' | 'commission' | 'net') => rows.reduce((s, r) => s + Number(r[k]), 0);
  const dateInput = 'h-10 rounded-sm border border-line bg-paper px-3 text-sm focus:border-ink focus:outline-none';
  return (
    <>
      <PageHeader title="Sales report" description="Your sales, VÉLORA commission and earnings by period. Cancelled and unpaid orders are excluded."
        actions={<Button variant="secondary" onClick={() => { setErr(null); downloadFile(`/vendor/reports/sales${qs({ ...query, format: 'csv' })}`, `velora-sales-${groupBy}.csv`).catch((e) => setErr(errorMessage(e))); }}>Download CSV</Button>} />
      {err && <div className="mb-4"><Alert tone="danger">{err}</Alert></div>}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">From <input type="date" className={dateInput} value={from} max={to} onChange={(e) => f.set('from', e.target.value)} /></label>
        <label className="flex items-center gap-2">to <input type="date" className={dateInput} value={to} min={from} onChange={(e) => f.set('to', e.target.value)} /></label>
        <FilterSelect label="Group by" value={groupBy} onChange={(v) => f.set('groupBy', v)} options={[['day', 'By day'], ['week', 'By week'], ['month', 'By month']]} />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!rows.length} emptyText="No sales in this period.">
          <Table head={['Period', 'Orders', 'Units', 'Returned', 'Sales', 'Commission', 'Your earnings']}>
            {rows.map((r) => (
              <tr key={r.period}>
                <Td className="font-medium">{groupBy === 'week' ? `Week of ${r.period}` : r.period}</Td>
                <Td>{r.orders}</Td><Td>{r.units}</Td><Td>{r.returned}</Td>
                <Td>{formatMoney(r.gross)}</Td><Td className="text-muted">{formatMoney(r.commission)}</Td><Td className="font-semibold">{formatMoney(r.net)}</Td>
              </tr>
            ))}
            <tr className="bg-ivory font-semibold">
              <Td>Total</Td><Td>{total('orders')}</Td><Td>{total('units')}</Td><Td>{total('returned')}</Td>
              <Td>{formatMoney(money('gross'))}</Td><Td>{formatMoney(money('commission'))}</Td><Td>{formatMoney(money('net'))}</Td>
            </tr>
          </Table>
        </QueryState>
      </Panel>
    </>
  );
}

export default function VendorReportsPage() {
  return <Suspense><ReportsInner /></Suspense>;
}
