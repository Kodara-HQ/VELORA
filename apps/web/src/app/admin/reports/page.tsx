'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FilterSelect, PageHeader, Panel, QueryState, Table, Td } from '@/components/admin/ui';
import { useCategories } from '@/components/site-chrome';
import { Alert, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { daysAgo, downloadFile, isoDay, qs } from '@/lib/admin';
import { formatMoney } from '@/lib/format';
import { errorMessage } from '@/lib/shop';

interface Report {
  rows: Array<{ period: string; orders: number; units: number; gross: string; discounts: string; netMerchandise: string; shipping: string }>;
  totals: { orders: number; units: number; gross: string; discounts: string; netMerchandise: string; shipping: string };
}

export default function ReportsPage() {
  const [from, setFrom] = useState(daysAgo(89));
  const [to, setTo] = useState(isoDay(new Date()));
  const [groupBy, setGroupBy] = useState('week');
  const [categoryId, setCategoryId] = useState('');
  const [channel, setChannel] = useState('');
  const [dlError, setDlError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const cats = useCategories();
  const params = { from, to, groupBy, categoryId, channel };
  const q = useQuery({ queryKey: ['sales-report', params], queryFn: () => api<Report>(`/admin/reports/sales${qs(params)}`), placeholderData: (p) => p });

  const download = async () => {
    setDlError(null);
    setDownloading(true);
    try { await downloadFile(`/admin/reports/sales${qs({ ...params, format: 'csv' })}`, 'velora-sales.csv'); }
    catch (e) { setDlError(errorMessage(e)); }
    finally { setDownloading(false); }
  };

  return (
    <>
      <PageHeader title="Sales report" description="Merchandise sales after discounts, excluding cancelled orders." actions={<Button variant="secondary" onClick={download} loading={downloading}>Download CSV</Button>} />
      {dlError && <div className="mb-4"><Alert tone="danger">{dlError}</Alert></div>}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-1 block h-10 rounded-sm border border-line bg-paper px-2 text-sm" /></label>
        <label className="text-xs font-semibold">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-1 block h-10 rounded-sm border border-line bg-paper px-2 text-sm" /></label>
        <FilterSelect label="Group by" value={groupBy} onChange={setGroupBy} options={[['day', 'By day'], ['week', 'By week'], ['month', 'By month']]} />
        <FilterSelect label="Department" value={categoryId} onChange={setCategoryId} options={[['', 'All departments'], ...(cats.data ?? []).map((c) => [String(c.id), c.name] as [string, string])]} />
        <FilterSelect label="Channel" value={channel} onChange={setChannel} options={[['', 'All channels'], ['web', 'Website'], ['mobile', 'Mobile app']]} />
      </div>
      <Panel padded={false}>
        <QueryState q={q} empty={!q.data?.rows.length} emptyText="No sales in this range.">
          {q.data && (
            <Table head={[groupBy === 'day' ? 'Day' : groupBy === 'week' ? 'Week of' : 'Month', 'Orders', 'Units', 'Gross', 'Discounts', 'Net merchandise', 'Delivery fees']}>
              {q.data.rows.map((r) => (
                <tr key={r.period}>
                  <Td className="font-medium">{r.period}</Td><Td>{r.orders}</Td><Td>{r.units}</Td><Td>{formatMoney(r.gross)}</Td>
                  <Td className="text-rose-deep">{Number(r.discounts) ? `−${formatMoney(r.discounts)}` : '—'}</Td>
                  <Td className="font-semibold">{formatMoney(r.netMerchandise)}</Td><Td>{formatMoney(r.shipping)}</Td>
                </tr>
              ))}
              <tr className="bg-ivory font-bold">
                <Td>Total</Td><Td>{q.data.totals.orders}</Td><Td>{q.data.totals.units}</Td><Td>{formatMoney(q.data.totals.gross)}</Td>
                <Td>{Number(q.data.totals.discounts) ? `−${formatMoney(q.data.totals.discounts)}` : '—'}</Td>
                <Td>{formatMoney(q.data.totals.netMerchandise)}</Td><Td>{formatMoney(q.data.totals.shipping)}</Td>
              </tr>
            </Table>
          )}
        </QueryState>
      </Panel>
    </>
  );
}
