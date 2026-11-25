'use client';

import Image from 'next/image';
import Link from 'next/link';
import { formatDateTime, formatMoney } from '@/lib/format';
import { cx } from '@/lib/cx';
import { ORDER_STATUS_LABEL, RETURN_STATUS_LABEL, type Order, type OrderStatus } from '@/lib/types';
import { PayNow } from './pay-now';
import { AddressText } from './address-form';
import { Row } from './shop-overlays';
import { Badge } from './ui';

const PROGRESS: OrderStatus[] = ['PROCESSING', 'SHIPPED', 'DELIVERED'];
const PROGRESS_LABEL = ['Order placed', 'Being prepared', 'On its way', 'Delivered'];

export function StatusBadge({ status }: { status: OrderStatus }) {
  const tone = status === 'CANCELLED' || status === 'REFUNDED' ? 'danger' : status === 'DELIVERED' || status === 'COMPLETED' ? 'success' : 'neutral';
  return <Badge tone={tone}>{ORDER_STATUS_LABEL[status]}</Badge>;
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

const REFUND_LABEL: Record<string, string> = { REQUESTED: 'Being reviewed', APPROVED: 'Approved', PROCESSING: 'On its way to you', COMPLETED: 'Refunded', REJECTED: 'Declined', FAILED: 'Failed' };
const PAY_METHOD: Record<string, string> = { CARD: 'card', MOMO_MTN: 'MTN MoMo', MOMO_TELECEL: 'Telecel Cash', MOMO_AT: 'AT Money', BANK_TRANSFER: 'bank transfer', ONLINE: 'online payment' };

export function OrderView({ order, actions, guestEmail }: { order: Order; actions?: React.ReactNode; guestEmail?: string | null }) {
  const cancelled = order.status === 'CANCELLED';
  const awaiting = order.status === 'PENDING_PAYMENT';
  const reached = order.status === 'DELIVERED' || order.status === 'COMPLETED' || order.status.includes('REFUNDED') ? 3
    : order.status === 'SHIPPED' || order.status === 'PARTIALLY_SHIPPED' ? 2 : awaiting ? 0 : 1;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <section className="rounded-sm border border-line bg-paper p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted">Order {order.orderNumber} · {formatDateTime(order.placedAt)}</p>
              <h2 className="mt-1 font-display text-xl font-bold">
                {cancelled ? 'This order was cancelled' : awaiting ? 'Awaiting payment' : order.estimatedDelivery ? `Arriving ${fmtDay(order.estimatedDelivery.from)}${order.estimatedDelivery.from.slice(0, 10) !== order.estimatedDelivery.to.slice(0, 10) ? ` – ${fmtDay(order.estimatedDelivery.to)}` : ''}` : ORDER_STATUS_LABEL[order.status]}
              </h2>
            </div>
            <StatusBadge status={order.status} />
          </div>
          {!cancelled && (
            <ol className="mt-6 grid grid-cols-4 gap-2" aria-label="Order progress">
              {PROGRESS_LABEL.map((label, i) => (
                <li key={label} className="text-xs" aria-current={i === reached ? 'step' : undefined}>
                  <span className={cx('block h-1.5 rounded-full', i <= reached ? 'bg-ink' : 'bg-sand')} />
                  <span className={cx('mt-2 block', i <= reached ? 'font-semibold' : 'text-muted')}>{label}</span>
                </li>
              ))}
            </ol>
          )}
          {cancelled && order.cancelReason && <p className="mt-3 text-sm text-muted">Reason: {order.cancelReason}</p>}
          {order.canPay && <div className="mt-6"><PayNow orderNumber={order.orderNumber} deadline={order.paymentDueAt} email={guestEmail} /></div>}
          {actions && <div className="mt-6 flex flex-wrap gap-3">{actions}</div>}
        </section>

        <section className="rounded-sm border border-line bg-paper p-6">
          <h2 className="font-display text-lg font-bold">Items ({order.itemCount})</h2>
          <ul className="mt-4 divide-y divide-line">
            {order.items.map((i) => (
              <li key={i.sku} className="flex gap-4 py-4">
                <span className="relative h-24 w-18 shrink-0 overflow-hidden rounded-sm bg-sand" style={{ width: 72 }}>
                  {i.image && <Image src={i.image} alt="" fill sizes="72px" className="object-cover" />}
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  {i.slug ? <Link href={`/p/${i.slug}`} className="font-medium hover:underline">{i.name}</Link> : <span className="font-medium">{i.name}</span>}
                  {i.variantLabel && <p className="text-muted">{i.variantLabel}</p>}
                  <p className="text-muted">Qty {i.quantity} × {formatMoney(i.unitPrice)}</p>
                </div>
                <p className="text-sm font-semibold">{formatMoney(i.lineTotal)}</p>
              </li>
            ))}
          </ul>
        </section>

        {order.history.length > 0 && (
          <section className="rounded-sm border border-line bg-paper p-6">
            <h2 className="font-display text-lg font-bold">Timeline</h2>
            <ol className="mt-4 space-y-4 border-l border-line pl-5">
              {[...order.history].reverse().map((h, idx) => (
                <li key={idx} className="relative text-sm">
                  <span className={cx('absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full', idx === 0 ? 'bg-ink' : 'bg-stone')} />
                  <p className="font-semibold">{ORDER_STATUS_LABEL[h.status]}</p>
                  {h.note && <p className="text-muted">{h.note}</p>}
                  <p className="text-xs text-muted">{formatDateTime(h.at)}</p>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      <aside className="h-fit space-y-6">
        <section className="rounded-sm border border-line bg-paper p-6">
          <h2 className="font-display text-lg font-bold">Summary</h2>
          <div className="mt-4 space-y-2">
            <Row label="Subtotal" value={formatMoney(order.subtotal)} />
            {Number(order.discountTotal) > 0 && <Row label={`Discount${order.couponCode ? ` (${order.couponCode})` : ''}`} value={`−${formatMoney(order.discountTotal)}`} accent />}
            <Row label="Delivery" value={Number(order.shippingTotal) === 0 ? 'Free' : formatMoney(order.shippingTotal)} />
            {Number(order.taxTotal) > 0 && <Row label="Tax" value={formatMoney(order.taxTotal)} />}
            <div className="border-t border-line pt-3"><Row label="Total" value={formatMoney(order.grandTotal)} strong /></div>
          </div>
          {order.payment && (
            <p className="mt-4 rounded-sm bg-sand px-3 py-2 text-xs">
              {order.payment.method === 'CASH'
                ? order.status === 'CANCELLED' ? 'Pay on delivery · nothing to pay'
                  : order.paymentStatus === 'PAID' ? `Paid on delivery · ${formatMoney(order.grandTotal)}` : `Pay on delivery · ${formatMoney(order.grandTotal)} due to the rider (cash or MoMo)`
                : order.payment.status === 'SUCCESS' ? `Paid by ${PAY_METHOD[order.payment.method] ?? 'online payment'}`
                : awaiting ? 'Awaiting online payment' : 'Online payment not completed'}
            </p>
          )}
          {order.refunds.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-xs">
              {order.refunds.map((r, i) => (
                <li key={i} className="flex justify-between gap-2 rounded-sm bg-success-soft px-3 py-2 text-success">
                  <span>Refund · {REFUND_LABEL[r.status] ?? r.status}</span><b>{formatMoney(r.amount)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
        {order.returns.length > 0 && (
          <section className="rounded-sm border border-line bg-paper p-6">
            <h2 className="font-display text-lg font-bold">Returns</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {order.returns.map((r) => (
                <li key={r.returnNumber} className="flex justify-between gap-2">
                  <span>{r.type === 'EXCHANGE' ? 'Exchange' : 'Return'} <span className="font-mono text-xs">{r.returnNumber}</span></span>
                  <span className="text-muted">{RETURN_STATUS_LABEL[r.status] ?? r.status}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="rounded-sm border border-line bg-paper p-6">
          <h2 className="font-display text-lg font-bold">Delivery</h2>
          <div className="mt-3"><AddressText a={order.shippingAddress as never} /></div>
          {order.shippingMethod && <p className="mt-3 text-sm text-muted">{order.shippingMethod.name}{order.shippingMethod.carrier && ` · ${order.shippingMethod.carrier}`}</p>}
          {order.shipments.filter((s) => s.trackingNumber).map((s) => <p key={s.trackingNumber} className="mt-2 text-sm">Tracking: <b>{s.trackingNumber}</b> ({s.carrier})</p>)}
        </section>
      </aside>
    </div>
  );
}
