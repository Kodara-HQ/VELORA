import type { Order } from '@/lib/types';

export interface AdminOrder extends Order {
  id: number; channel: string; customerNote: string | null; guestPhone: string | null;
  customer: { id: number; firstName: string; lastName: string; email: string; phone: string | null; customer: { orderCount: number; lifetimeValue: string } | null } | null;
  lines: Array<{ id: number; name: string; variantLabel: string | null; sku: string; image: string | null; productId: number | null; unitPrice: string; quantity: number; discount: string; lineTotal: string; warehouse: string | null; vendor: string | null }>;
  payments: Array<{ method: string; provider: string; status: string; reference: string; amount: string }>;
  shipmentsFull: Array<{ id: number; carrier: string; trackingNumber: string | null; status: string; riderName: string | null; riderPhone: string | null; dispatchedAt: string | null; deliveredAt: string | null;
    events: Array<{ id: number; status: string; description: string; location: string | null; occurredAt: string }> }>;
  refunds: Array<{ id: number; amount: string; status: string; reason: string; createdAt: string; processedAt: string | null }>;
  historyFull: Array<{ status: string; note: string | null; at: string; by: string | null }>;
  can: { ship: boolean; deliver: boolean; cancel: boolean };
}

export interface VendorOrder {
  orderNumber: string; status: string; placedAt: string;
  customer: { firstName: string; city: string | null; region: string | null };
  lines: Array<{ id: number; name: string; variantLabel: string | null; sku: string; image: string | null; quantity: number; quantityReturned: number; lineTotal: string; commission: string; net: string; earningStatus: string | null }>;
  totals: { gross: string; commission: string; net: string };
}

export interface VendorStats {
  orders: number; units: number; grossSales: string; returnedUnits: number; returnRate: number; rating: number; reviewCount: number;
  products: { active: number; pendingReview: number; draft: number; rejected: number; archived: number };
  earnings: { onHold: string; payable: string; settled: string; commissionTaken: string };
}

export interface VendorApplication {
  id: number; businessName: string; registrationNumber: string | null; taxId: string | null; contactPhone: string; businessAddress: string;
  productCategories: string[] | null; documents: { about?: string } | null; status: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
  reviewNotes: string | null; reviewedAt: string | null; createdAt: string;
  user: { id: number; firstName: string; lastName: string; email: string; phone: string | null; createdAt: string; customer?: { orderCount: number } | null };
  reviewedBy: { firstName: string; lastName: string } | null;
}
