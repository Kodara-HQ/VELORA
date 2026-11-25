'use client';

import { Panel, StatusPill, Table, Td } from '@/components/admin/ui';
import { formatMoney } from '@/lib/format';

export interface SettlementDetail {
  id: number; reference: string; status: string; periodStart: string; periodEnd: string; grossAmount: string; commissionAmount: string; netAmount: string; adjustments: string;
  paidAt: string | null; payoutReference: string | null; createdAt: string;
  vendor: { id: number; businessName: string; payoutMethod: string | null; payoutDetails: { accountName?: string; number?: string; bankName?: string } | null };
  commissions: Array<{ id: number; rate: string; grossAmount: string; commissionAmount: string; netAmount: string; orderNumber: string; placedAt: string; product: string; variant: string | null; sku: string; quantity: number }>;
}

export const PAYOUT_METHOD: Record<string, string> = { MOMO_MTN: 'MTN MoMo', MOMO_TELECEL: 'Telecel Cash', MOMO_AT: 'AirtelTigo Money', BANK: 'Bank transfer' };
const d = (s: string) => new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Statement body shared by the vendor portal and the admin settlements screen. */
export function SettlementView({ s, orderHref }: { s: SettlementDetail; orderHref: (n: string) => string }) {
  const pd = s.vendor.payoutDetails;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel title={`${s.commissions.length} sales`} padded={false}>
        <Table head={['Order', 'Item', 'Sale', 'Commission', 'Net']}>
          {s.commissions.map((c) => (
            <tr key={c.id}>
              <Td><a href={orderHref(c.orderNumber)} className="font-medium hover:underline">{c.orderNumber}</a><span className="block text-xs text-muted">{d(c.placedAt)}</span></Td>
              <Td>{c.product}<span className="block text-xs text-muted">{c.variant} · <span className="font-mono">{c.sku}</span> · ×{c.quantity}</span></Td>
              <Td>{formatMoney(c.grossAmount)}</Td>
              <Td className="text-muted">{formatMoney(c.commissionAmount)} <span className="text-xs">({c.rate}%)</span></Td>
              <Td className="font-semibold">{formatMoney(c.netAmount)}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
      <div className="space-y-6">
        <Panel title="Statement">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Status</dt><dd><StatusPill status={s.status} /></dd></div>
            <div className="flex justify-between"><dt className="text-muted">Period</dt><dd>{d(s.periodStart)} – {d(s.periodEnd)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Sales</dt><dd>{formatMoney(s.grossAmount)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Commission</dt><dd>− {formatMoney(s.commissionAmount)}</dd></div>
            {Number(s.adjustments) !== 0 && <div className="flex justify-between"><dt className="text-muted">Adjustments</dt><dd>{formatMoney(s.adjustments)}</dd></div>}
            <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Payout</dt><dd>{formatMoney(s.netAmount)}</dd></div>
            {s.paidAt && <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd>{d(s.paidAt)}</dd></div>}
            {s.payoutReference && <div className="flex justify-between gap-3"><dt className="text-muted">Reference</dt><dd className="break-all font-mono text-xs">{s.payoutReference}</dd></div>}
          </dl>
        </Panel>
        <Panel title="Paid to">
          {s.vendor.payoutMethod && pd ? (
            <p className="text-sm">{PAYOUT_METHOD[s.vendor.payoutMethod] ?? s.vendor.payoutMethod}<br />{pd.accountName}<br /><span className="font-mono">{pd.bankName ? `${pd.bankName} · ` : ''}{pd.number}</span></p>
          ) : <p className="text-sm text-danger">No payout details on file.</p>}
        </Panel>
      </div>
    </div>
  );
}
