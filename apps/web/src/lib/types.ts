/** Shapes returned by the storefront API (money is always a decimal string). */

export interface ProductCard {
  id: number;
  slug: string;
  name: string;
  brand: { name: string; slug: string } | null;
  vendor: { name: string; slug: string } | null;
  price: string;
  compareAtPrice: string | null;
  currency: string;
  image: { url: string; alt: string } | null;
  hoverImage: { url: string; alt: string } | null;
  colors: Array<{ name: string; hex: string | null }>;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  isNew: boolean;
}

export interface CategoryTreeNode {
  id: number;
  name: string;
  slug: string;
  imageUrl: string | null;
  children: CategoryTreeNode[];
}

export interface Variant {
  id: number;
  sku: string;
  color: string | null;
  colorHex: string | null;
  size: string | null;
  price: string;
  compareAtPrice: string | null;
  available: number;
  lowStock: boolean;
}

export interface SizeGuide {
  unit: string;
  note?: string;
  columns: string[];
  rows: string[][];
}

export interface ProductDetail {
  id: number;
  slug: string;
  name: string;
  styleCode: string;
  brand: { name: string; slug: string } | null;
  vendor: { name: string; slug: string } | null;
  shortDescription: string | null;
  description: string | null;
  material: string | null;
  careInstructions: string | null;
  videoUrl: string | null;
  price: string;
  compareAtPrice: string | null;
  currency: string;
  rating: number;
  reviewCount: number;
  breadcrumbs: Array<{ name: string; slug: string }>;
  images: Array<{ id: number; url: string; alt: string; color: string | null }>;
  attributes: Array<{ name: string; value: string }>;
  variants: Variant[];
  sizeGuide: SizeGuide | null;
  reviewSummary: { average: number; total: number; distribution: Array<{ rating: number; count: number }> };
  questions: Array<{ id: number; question: string; answer: string; answeredAt: string }>;
  delivery: Array<{ zone: string; method: string; fee: string; freeOver: string | null; minDays: number; maxDays: number }>;
}

export interface Review {
  id: number;
  rating: number;
  title: string | null;
  body: string | null;
  fit: 'RUNS_SMALL' | 'TRUE_TO_SIZE' | 'RUNS_LARGE' | null;
  isVerifiedBuyer: boolean;
  helpfulCount: number;
  createdAt: string;
  author: string;
}

export interface Facets {
  brands: Array<{ name: string; slug: string; count: number }>;
  colors: Array<{ name: string; hex: string | null; count: number }>;
  sizes: Array<{ name: string; count: number }>;
  price: { min: string; max: string };
}

export interface CartLine {
  id: number;
  variantId: number;
  productId: number;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  sku: string;
  color: string | null;
  size: string | null;
  variantLabel: string;
  unitPrice: string;
  compareAtPrice: string | null;
  quantity: number;
  available: number;
  lineTotal: string;
  issue: 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | null;
}

export interface Cart {
  id: number | null;
  currency: string;
  items: CartLine[];
  itemCount: number;
  coupon: { code: string; description: string | null; valid: boolean; reason: string | null; discount: string; freeShipping: boolean } | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  estimatedTotal: string;
  hasIssues: boolean;
  notice?: string | null;
}

export interface ShippingOption {
  id: number;
  code: string;
  name: string;
  carrier: string | null;
  zone: string;
  baseFee: string;
  fee: string;
  freeOver: string | null;
  minDays: number;
  maxDays: number;
}

export interface Quote {
  shippingMethodId: number;
  subtotal: string;
  discountTotal: string;
  shippingTotal: string;
  taxTotal: string;
  taxIncluded: string;
  grandTotal: string;
  coupon: { code: string; valid: boolean; reason: string | null; discount: string } | null;
  issues: Array<{ sku: string; name: string; issue: string; available: number }>;
}

export interface Address {
  id: number;
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  digitalAddress: string | null;
  landmark: string | null;
  isDefault: boolean;
}

export type OrderStatus =
  | 'PENDING_PAYMENT' | 'PAID' | 'PROCESSING' | 'PARTIALLY_SHIPPED' | 'SHIPPED' | 'DELIVERED' | 'COMPLETED'
  | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

export interface Order {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: string;
  placedAt: string;
  currency: string;
  email: string | null;
  items: Array<{ name: string; variantLabel: string | null; sku: string; image: string | null; slug: string | null; unitPrice: string; quantity: number; lineTotal: string }>;
  itemCount: number;
  subtotal: string;
  discountTotal: string;
  shippingTotal: string;
  taxTotal: string;
  grandTotal: string;
  couponCode: string | null;
  shippingAddress: Omit<Address, 'id' | 'isDefault'>;
  shippingMethod: { name: string; minDays: number; maxDays: number; carrier: string | null } | null;
  estimatedDelivery: { from: string; to: string } | null;
  payment: { method: string; status: string; reference: string } | null;
  history: Array<{ status: OrderStatus; note: string | null; at: string }>;
  shipments: Array<{ carrier: string; trackingNumber: string | null; status: string; events: Array<{ status: string; description: string; location: string | null; occurredAt: string }> }>;
  canCancel: boolean;
  cancelReason: string | null;
  paymentDueAt: string | null;
  canPay: boolean;
  refunds: Array<{ amount: string; status: string; reason: string; createdAt: string; processedAt: string | null }>;
  returns: Array<{ returnNumber: string; type: 'RETURN' | 'EXCHANGE'; status: string; createdAt: string }>;
  deliveredAt: string | null;
}

export interface NextAction { type: 'redirect'; url: string; reference: string; provider: string }
export interface PlacedOrder extends Order { nextAction: NextAction | null; paymentError: string | null }
export interface PaymentMethodOption { code: string; label: string; detail: string; online: boolean }

export interface ReturnRequest {
  returnNumber: string; type: 'RETURN' | 'EXCHANGE'; status: string; reason: string; customerNote: string | null; adminNote: string | null;
  createdAt: string; approvedAt: string | null; receivedAt: string | null; closedAt: string | null; refundAmount: string | null;
  order: { orderNumber: string };
  items: Array<{ id: number; quantity: number; condition: string | null; restock: boolean; name: string; variantLabel: string | null; sku: string; image: string | null; unitPaid: string; exchangeFor: { sku: string; label: string } | null }>;
  refunds: Array<{ id: number; amount: string; status: string; method: string | null; providerReference: string | null; processedAt: string | null }>;
  customer?: string | null;
}

export const RETURN_REASONS: Record<string, string> = {
  WRONG_SIZE: 'Wrong size', NOT_AS_DESCRIBED: 'Not as described', DAMAGED: 'Arrived damaged', DEFECTIVE: 'Faulty',
  WRONG_ITEM: 'Wrong item sent', CHANGED_MIND: 'Changed my mind', LATE_DELIVERY: 'Arrived too late', OTHER: 'Other',
};

export const RETURN_STATUS_LABEL: Record<string, string> = {
  REQUESTED: 'Requested', APPROVED: 'Approved: send it back', REJECTED: 'Declined', ITEMS_RECEIVED: 'Received: refund in progress',
  REFUNDED: 'Refunded', EXCHANGED: 'Exchange sent', CLOSED: 'Closed',
};

export interface OrderSummary {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: string;
  placedAt: string;
  grandTotal: string;
  currency: string;
  itemCount: number;
  previews: Array<{ image: string | null; name: string }>;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PAID: 'Paid',
  PROCESSING: 'Being prepared',
  PARTIALLY_SHIPPED: 'Partly shipped',
  SHIPPED: 'On its way',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partly refunded',
};
