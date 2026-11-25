/** Shapes returned by the VÉLORA API (the subset the app uses). */

export interface PromoBadge { name: string; slug: string; type: string; endsAt: string; stockLeft: number | null; percentOff: number }

export interface ProductCard {
  id: number; slug: string; name: string;
  brand: { name: string; slug: string } | null; vendor: { name: string; slug: string } | null;
  price: string; compareAtPrice: string | null; currency: string;
  image: { url: string; alt: string } | null;
  colors: Array<{ name: string; hex: string | null }>;
  rating: number; reviewCount: number; inStock: boolean; isNew: boolean;
  promotion?: PromoBadge | null;
}

export interface Variant { id: number; sku: string; color: string | null; colorHex: string | null; size: string | null; price: string; compareAtPrice: string | null; available: number; lowStock: boolean }

export interface ProductDetail {
  id: number; slug: string; name: string; styleCode: string;
  brand: { name: string; slug: string } | null; vendor: { name: string; slug: string } | null;
  shortDescription: string | null; description: string | null; material: string | null; careInstructions: string | null;
  price: string; compareAtPrice: string | null; currency: string; rating: number; reviewCount: number;
  images: Array<{ id: number; url: string; alt: string; color: string | null }>;
  attributes: Array<{ name: string; value: string }>;
  variants: Variant[];
  delivery: Array<{ zone: string; method: string; fee: string; freeOver: string | null; minDays: number; maxDays: number }>;
  promotion: PromoBadge | null;
}

export interface CategoryNode { id: number; name: string; slug: string; imageUrl?: string | null; children: CategoryNode[] }

export interface HomeFeed {
  categories: Array<{ name: string; slug: string; imageUrl: string | null }>;
  newArrivals: ProductCard[]; bestSellers: ProductCard[]; onSale: ProductCard[]; featured: ProductCard[];
}

export interface LiveSale { name: string; slug: string; type: string; headline: string | null; startsAt: string; endsAt: string; state: 'LIVE' | 'SCHEDULED'; products: ProductCard[] }

export interface CartLine {
  id: number; variantId: number; productId: number; slug: string; name: string; brand: string | null; image: string | null;
  variantLabel: string; unitPrice: string; compareAtPrice: string | null; quantity: number; available: number; lineTotal: string;
  issue: 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | null;
  promotion: { name: string; endsAt: string } | null;
}

export interface Cart {
  id: number | null; items: CartLine[]; itemCount: number;
  coupon: { code: string; valid: boolean; reason: string | null; discount: string } | null;
  subtotal: string; discountTotal: string; estimatedTotal: string; hasIssues: boolean; notice?: string | null;
}

export interface ShippingOption { id: number; name: string; fee: string; minDays: number; maxDays: number; freeOver: string | null }

export interface Quote {
  shippingMethodId: number; subtotal: string; discountTotal: string; shippingTotal: string; taxTotal: string; grandTotal: string;
  coupon: { code: string; valid: boolean; reason: string | null; discount: string } | null;
  loyalty: { balance: number; maxPoints: number; points: number; value: string } | null;
}

export interface Address { id: number; label: string | null; recipientName: string; phone: string; line1: string; line2: string | null; city: string; region: string; isDefault: boolean }

export interface PaymentMethodOption { code: string; label: string; detail: string; online: boolean }

export interface Order {
  orderNumber: string; status: string; paymentStatus: string; placedAt: string;
  items: Array<{ name: string; variantLabel: string | null; image: string | null; slug: string | null; unitPrice: string; quantity: number; lineTotal: string }>;
  itemCount: number; subtotal: string; discountTotal: string; shippingTotal: string; grandTotal: string;
  loyaltyPointsUsed: number; loyaltyDiscount: string;
  shippingAddress: { recipientName: string; phone: string; line1: string; city: string; region: string };
  estimatedDelivery: { from: string; to: string } | null;
  payment: { method: string; status: string } | null;
  history: Array<{ status: string; note: string | null; at: string }>;
  canCancel: boolean; canPay: boolean; paymentDueAt: string | null;
}

export interface PlacedOrder extends Order { nextAction: { url: string; reference: string } | null; paymentError: string | null }

export interface OrderSummary { orderNumber: string; status: string; placedAt: string; itemCount: number; grandTotal: string; previews: Array<{ image: string | null; name: string }> }

export interface LoyaltySummary {
  pointsBalance: number; lifetimePoints: number; tier: string; pointsValue: string; multiplier: number; perks: string[];
  nextTier: { tier: string; pointsNeeded: number; min: number; currentMin: number } | null;
  referral: { code: string; bonusPoints: number; friendBonusPoints: number; invited: number; rewarded: number };
}

export interface AppNotification { id: number; type: string; title: string; body: string; data: { href?: string } | null; readAt: string | null; createdAt: string }
