'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { QueryState } from '@/components/admin/ui';
import { Button, Logo } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { AdminOrder } from '@/components/admin/types';

/** Printable invoice / packing slip. Screen chrome is hidden when printing. */
function PrintDoc() {
  const { number } = useParams<{ number: string }>();
  const doc = useSearchParams().get('doc') === 'packing' ? 'packing' : 'invoice';
  const q = useQuery({ queryKey: ['admin-order', number], queryFn: () => api<AdminOrder>(`/admin/orders/${number}`) });
  const o = q.data;
  const a = o?.shippingAddress as unknown as Record<string, string> | undefined;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3 print:hidden">
        <Link href={`/admin/orders/${number}`} className="text-sm font-semibold underline">← Back to order</Link>
        <Button size="sm" className="ml-auto" onClick={() => window.print()}>Print</Button>
      </div>
      <QueryState q={q}>
        {o && a && (
          <article className="mx-auto max-w-3xl bg-paper p-10 text-sm text-ink shadow-sm print:max-w-none print:p-0 print:shadow-none">
            <header className="flex items-start justify-between border-b-2 border-ink pb-6">
              <div><Logo className="text-xl" /><p className="mt-3 text-xs leading-relaxed text-muted">VÉLORA Fulfilment Centre<br />Spintex Road, Accra<br />care@velora.test · +233 30 000 0000</p></div>
              <div className="text-right">
                <h1 className="font-display text-2xl font-extrabold uppercase tracking-wide">{doc === 'invoice' ? 'Invoice' : 'Packing slip'}</h1>
                <p className="mt-2">Order <b>{o.orderNumber}</b></p>
                <p className="text-muted">{formatDateTime(o.placedAt)}</p>
                {doc === 'invoice' && <p className="mt-1 text-muted">Payment: {o.payment?.method === 'CASH' ? 'Pay on delivery' : o.payment?.method} · {o.paymentStatus.toLowerCase()}</p>}
              </div>
            </header>
            <section className="grid grid-cols-2 gap-8 py-6">
              <div><p className="text-xs font-semibold uppercase tracking-wider text-muted">Deliver to</p>
                <p className="mt-2 leading-relaxed"><b>{a.recipientName}</b><br />{a.line1}{a.line2 && <>, {a.line2}</>}<br />{a.city}, {a.region}{a.digitalAddress && <><br />{a.digitalAddress}</>}{a.landmark && <><br />{a.landmark}</>}<br />{a.phone}</p></div>
              <div><p className="text-xs font-semibold uppercase tracking-wider text-muted">Customer</p>
                <p className="mt-2 leading-relaxed">{o.customer ? `${o.customer.firstName} ${o.customer.lastName}` : 'Guest'}<br />{o.email}<br />{o.shippingMethod?.name}</p></div>
            </section>
            <table className="w-full border-collapse">
              <thead><tr className="border-b border-ink text-left text-xs uppercase tracking-wider">
                <th className="py-2">Item</th><th className="py-2">SKU</th>{doc === 'packing' && <th className="py-2">Bin / WH</th>}<th className="py-2 text-right">Qty</th>
                {doc === 'invoice' && <><th className="py-2 text-right">Unit</th><th className="py-2 text-right">Total</th></>}
                {doc === 'packing' && <th className="w-16 py-2 text-center">Picked</th>}
              </tr></thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.id} className="border-b border-line">
                    <td className="py-2.5">{l.name}<span className="block text-xs text-muted">{l.variantLabel}</span></td>
                    <td className="py-2.5 font-mono text-xs">{l.sku}</td>
                    {doc === 'packing' && <td className="py-2.5">{l.warehouse}</td>}
                    <td className="py-2.5 text-right">{l.quantity}</td>
                    {doc === 'invoice' && <><td className="py-2.5 text-right">{formatMoney(l.unitPrice)}</td><td className="py-2.5 text-right">{formatMoney(l.lineTotal)}</td></>}
                    {doc === 'packing' && <td className="py-2.5 text-center"><span className="inline-block h-4 w-4 border border-ink" /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {doc === 'invoice' ? (
              <div className="ml-auto mt-6 max-w-xs space-y-1.5">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(o.subtotal)}</span></div>
                {Number(o.discountTotal) > 0 && <div className="flex justify-between"><span>Discount{o.couponCode && ` (${o.couponCode})`}</span><span>−{formatMoney(o.discountTotal)}</span></div>}
                <div className="flex justify-between"><span>Delivery</span><span>{formatMoney(o.shippingTotal)}</span></div>
                {Number(o.taxTotal) > 0 && <div className="flex justify-between"><span>Tax</span><span>{formatMoney(o.taxTotal)}</span></div>}
                <div className="flex justify-between border-t-2 border-ink pt-2 text-base font-bold"><span>Total</span><span>{formatMoney(o.grandTotal)}</span></div>
              </div>
            ) : (
              <p className="mt-8 text-xs text-muted">{o.itemCount} item(s). {o.customerNote && <>Customer note: “{o.customerNote}”.</>} Packed by: ____________</p>
            )}
            <footer className="mt-12 border-t border-line pt-4 text-center text-xs text-muted">Thank you for shopping with VÉLORA · Returns within 14 days of delivery</footer>
          </article>
        )}
      </QueryState>
    </div>
  );
}

export default function PrintPage() {
  return <Suspense><PrintDoc /></Suspense>;
}
