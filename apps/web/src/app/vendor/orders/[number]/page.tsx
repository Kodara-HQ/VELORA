'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { PageHeader, Panel, QueryState, StatusPill, humanize } from '@/components/admin/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { VendorOrder } from '@/components/admin/types';

const EARNING_NOTE: Record<string, string> = {
  PENDING: 'Held until the order is delivered and the return window closes',
  ELIGIBLE: 'Return window closing; included in your next statement',
  SETTLED: 'Paid out',
  REVERSED: 'Reversed (cancelled or refunded)',
};

export default function VendorOrderPage() {
  const { number } = useParams<{ number: string }>();
  const q = useQuery({ queryKey: ['vendor-order', number], queryFn: () => api<VendorOrder>(`/vendor/orders/${number}`) });
  const o = q.data;
  return (
    <>
      <PageHeader title={`Order ${number}`} back={{ href: '/vendor/orders', label: 'Orders' }}
        description={o && <span className="flex flex-wrap items-center gap-2"><StatusPill status={o.status} /> Placed {new Date(o.placedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>} />
      <QueryState q={q}>
        {o && (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <Panel title="Your items in this order" padded={false}>
              <ul className="divide-y divide-line">
                {o.lines.map((l) => (
                  <li key={l.id} className="flex gap-4 px-5 py-4">
                    <span className="h-20 w-16 shrink-0 overflow-hidden rounded-sm bg-sand">{l.image && <img src={l.image} alt="" className="h-full w-full object-cover" />}</span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-semibold">{l.name}</p>
                      <p className="text-muted">{l.variantLabel} · <span className="font-mono text-xs">{l.sku}</span> · ×{l.quantity}{l.quantityReturned > 0 && <span className="text-danger"> ({l.quantityReturned} returned)</span>}</p>
                      {l.earningStatus && <p className="mt-1 text-xs text-muted">{humanize(l.earningStatus)}: {EARNING_NOTE[l.earningStatus]}</p>}
                    </div>
                    <dl className="shrink-0 text-right text-sm">
                      <dt className="sr-only">Sale</dt><dd>{formatMoney(l.lineTotal)}</dd>
                      <dt className="sr-only">Commission</dt><dd className="text-xs text-muted">− {formatMoney(l.commission)} fee</dd>
                      <dt className="sr-only">Your earnings</dt><dd className="font-semibold">{formatMoney(l.net)}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            </Panel>
            <div className="space-y-6">
              <Panel title="Summary">
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between"><dt className="text-muted">Sales</dt><dd>{formatMoney(o.totals.gross)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">VÉLORA commission</dt><dd>− {formatMoney(o.totals.commission)}</dd></div>
                  <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Your earnings</dt><dd>{formatMoney(o.totals.net)}</dd></div>
                </dl>
              </Panel>
              <Panel title="Delivery">
                <p className="text-sm">{o.customer.firstName}<br /><span className="text-muted">{[o.customer.city, o.customer.region].filter(Boolean).join(', ')}</span></p>
                <p className="mt-3 text-xs text-muted">VÉLORA handles delivery and customer contact. Hand the items to our rider or drop them at the hub when the order shows as Processing.</p>
              </Panel>
            </div>
          </div>
        )}
      </QueryState>
    </>
  );
}
