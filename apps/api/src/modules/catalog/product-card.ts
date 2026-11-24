import { Prisma, ProductStatus, VendorStatus } from '@prisma/client';

/** Fields needed to render a product card anywhere in the storefront. */
export const cardSelect = {
  id: true, slug: true, name: true, basePrice: true, compareAtPrice: true, currency: true,
  avgRating: true, reviewCount: true, publishedAt: true, categoryId: true,
  brand: { select: { name: true, slug: true } },
  vendor: { select: { businessName: true, slug: true } },
  images: { orderBy: { sortOrder: 'asc' }, take: 2, select: { url: true, altText: true } },
  variants: {
    where: { isActive: true, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { color: true, colorHex: true, inventory: { select: { quantityOnHand: true, quantityReserved: true } } },
  },
} satisfies Prisma.ProductSelect;

export type CardRow = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

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

const NEW_DAYS = 30;

export function toCard(p: CardRow): ProductCard {
  const colors = new Map<string, string | null>();
  let inStock = false;
  for (const v of p.variants) {
    if (v.color && !colors.has(v.color)) colors.set(v.color, v.colorHex);
    if (!inStock && v.inventory.some((i) => i.quantityOnHand - i.quantityReserved > 0)) inStock = true;
  }
  const img = (i?: { url: string; altText: string | null }) => (i ? { url: i.url, alt: i.altText ?? p.name } : null);
  const sale = p.compareAtPrice && p.compareAtPrice.gt(p.basePrice) ? p.compareAtPrice.toFixed(2) : null;
  return {
    id: p.id, slug: p.slug, name: p.name,
    brand: p.brand,
    vendor: p.vendor ? { name: p.vendor.businessName, slug: p.vendor.slug } : null,
    price: p.basePrice.toFixed(2), compareAtPrice: sale, currency: p.currency,
    image: img(p.images[0]), hoverImage: img(p.images[1]),
    colors: [...colors].map(([name, hex]) => ({ name, hex })),
    rating: Number(p.avgRating), reviewCount: p.reviewCount, inStock,
    isNew: !!p.publishedAt && Date.now() - p.publishedAt.getTime() < NEW_DAYS * 86_400_000,
  };
}

/** Products a shopper may see: active, published, not deleted, and (if vendor-owned) from an active vendor. */
export function visibleWhere(): Prisma.ProductWhereInput {
  return {
    status: ProductStatus.ACTIVE,
    deletedAt: null,
    publishedAt: { lte: new Date() },
    OR: [{ vendorId: null }, { vendor: { status: VendorStatus.ACTIVE, deletedAt: null } }],
  };
}

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'One Size'];
export function sortSizes<T extends { name: string }>(sizes: T[]): T[] {
  const rank = (s: string) => {
    const i = SIZE_ORDER.indexOf(s);
    if (i >= 0) return i;
    const n = parseFloat(s);
    return Number.isNaN(n) ? 1000 : 100 + n;
  };
  return sizes.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}
