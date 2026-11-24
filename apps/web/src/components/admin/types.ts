import type { Order } from '@/lib/types';

export interface AdminOrder extends Order {
  id: number; channel: string; customerNote: string | null; guestPhone: string | null;
  customer: { id: number; firstName: string; lastName: string; email: string; phone: string | null; customer: { orderCount: number; lifetimeValue: string } | null } | null;
  lines: Array<{ id: number; name: string; variantLabel: string | null; sku: string; image: string | null; productId: number | null; unitPrice: string; quantity: number; discount: string; lineTotal: string; warehouse: string | null; vendor: string | null }>;
  payments: Array<{ method: string; provider: string; status: string; reference: string; amount: string }>;
  shipmentsFull: Array<{ id: number; carrier: string; trackingNumber: string | null; status: string; riderName: string | null; riderPhone: string | null; dispatchedAt: string | null; deliveredAt: string | null;
    events: Array<{ id: number; status: string; description: string; location: string | null; occurredAt: string }> }>;
  refunds: Array<{ id: number; amount: string; status: string; reason: string }>;
  historyFull: Array<{ status: string; note: string | null; at: string; by: string | null }>;
  can: { ship: boolean; deliver: boolean; cancel: boolean };
}
