import { OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';

export const orderInclude = {
  items: { orderBy: { id: 'asc' }, include: { product: { select: { slug: true } } } },
  shippingMethod: { select: { name: true, minDays: true, maxDays: true, carrier: true } },
  payments: { orderBy: { createdAt: 'desc' }, select: { method: true, provider: true, status: true, reference: true, amount: true } },
  statusHistory: { orderBy: { createdAt: 'asc' }, select: { toStatus: true, note: true, createdAt: true } },
  refunds: { orderBy: { createdAt: 'asc' }, select: { amount: true, status: true, reason: true, createdAt: true, processedAt: true } },
  returns: { orderBy: { createdAt: 'desc' }, select: { returnNumber: true, type: true, status: true, createdAt: true } },
  shipments: { select: { carrier: true, trackingNumber: true, status: true, dispatchedAt: true, deliveredAt: true,
    events: { orderBy: { occurredAt: 'desc' }, select: { status: true, description: true, location: true, occurredAt: true } } } },
} satisfies Prisma.OrderInclude;

export type OrderFull = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** A customer may cancel until the order leaves the warehouse. */
export const CUSTOMER_CANCELLABLE: OrderStatus[] = [OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, OrderStatus.PROCESSING];

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const f = (d: Prisma.Decimal | null) => (d == null ? null : d.toFixed(2));

/** Customer-facing order shape: no internal ids, costs or warehouse details. */
export function presentOrder(o: OrderFull) {
  const dispatched = o.shipments.some((s) => s.status !== ShipmentStatus.PENDING && s.status !== ShipmentStatus.PACKED);
  const base = o.paidAt ?? o.placedAt;
  // Merge split-warehouse lines back into one line per SKU for the customer.
  const lines = new Map<string, { name: string; variantLabel: string | null; sku: string; image: string | null; slug: string | null; unitPrice: string; quantity: number; lineTotal: Prisma.Decimal }>();
  for (const i of o.items) {
    const l = lines.get(i.sku);
    if (l) {
      l.quantity += i.quantity;
      l.lineTotal = l.lineTotal.add(i.lineTotal);
    } else {
      lines.set(i.sku, { name: i.productName, variantLabel: i.variantLabel, sku: i.sku, image: i.imageUrl, slug: i.product?.slug ?? null,
        unitPrice: i.unitPrice.toFixed(2), quantity: i.quantity, lineTotal: i.lineTotal });
    }
  }
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    placedAt: o.placedAt,
    currency: o.currency,
    email: o.guestEmail,
    items: [...lines.values()].map((l) => ({ ...l, lineTotal: l.lineTotal.toFixed(2) })),
    itemCount: o.items.reduce((s, i) => s + i.quantity, 0),
    subtotal: f(o.subtotal), discountTotal: f(o.discountTotal), shippingTotal: f(o.shippingTotal),
    taxTotal: f(o.taxTotal), grandTotal: f(o.grandTotal), refundedTotal: f(o.refundedTotal),
    couponCode: o.couponCode,
    loyaltyPointsUsed: o.loyaltyPointsUsed, loyaltyDiscount: f(o.loyaltyDiscount),
    shippingAddress: o.shippingAddress,
    shippingMethod: o.shippingMethod,
    estimatedDelivery: o.shippingMethod && o.status !== OrderStatus.CANCELLED
      ? { from: addDays(base, o.shippingMethod.minDays), to: addDays(base, Math.max(o.shippingMethod.maxDays, 1)) }
      : null,
    payment: o.payments[0] ? { method: o.payments[0].method, status: o.payments[0].status, reference: o.payments[0].reference } : null,
    history: o.statusHistory.map((h) => ({ status: h.toStatus, note: h.note, at: h.createdAt })),
    shipments: o.shipments,
    canCancel: CUSTOMER_CANCELLABLE.includes(o.status) && !dispatched,
    paymentDueAt: o.paymentDueAt,
    canPay: o.status === OrderStatus.PENDING_PAYMENT && (!o.paymentDueAt || o.paymentDueAt > new Date()),
    refunds: o.refunds.map((r) => ({ ...r, amount: r.amount.toFixed(2) })),
    returns: o.returns,
    deliveredAt: o.shipments.find((s) => s.deliveredAt)?.deliveredAt ?? null,
    cancelReason: o.cancelReason,
  };
}

export function orderSummary(o: { orderNumber: string; status: OrderStatus; paymentStatus: string; placedAt: Date; grandTotal: Prisma.Decimal; currency: string;
  items: Array<{ quantity: number; imageUrl: string | null; productName: string }> }) {
  return {
    orderNumber: o.orderNumber, status: o.status, paymentStatus: o.paymentStatus, placedAt: o.placedAt,
    grandTotal: o.grandTotal.toFixed(2), currency: o.currency,
    itemCount: o.items.reduce((s, i) => s + i.quantity, 0),
    previews: o.items.slice(0, 4).map((i) => ({ image: i.imageUrl, name: i.productName })),
  };
}
