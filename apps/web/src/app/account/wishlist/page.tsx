'use client';

import { useQuery } from '@tanstack/react-query';
import { ProductGrid, ProductGridSkeleton } from '@/components/product-card';
import { Alert, ButtonLink, EmptyState } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/shop';
import type { ProductCard } from '@/lib/types';

export default function WishlistPage() {
  const user = useSession((s) => s.user);
  const q = useQuery({ queryKey: ['wishlist', user?.id], queryFn: () => api<Array<{ addedAt: string; product: ProductCard }>>('/me/wishlist') });

  if (q.isPending) return <ProductGridSkeleton count={4} />;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  if (!q.data.length) {
    return <EmptyState title="Your wishlist is empty" body="Tap the heart on any piece to save it here for later."
      action={<ButtonLink href="/shop?sort=newest" variant="secondary">Discover new arrivals</ButtonLink>} />;
  }
  return (
    <div>
      <h2 className="mb-5 text-xl font-extrabold">Saved pieces ({q.data.length})</h2>
      <ProductGrid products={q.data.map((i) => i.product)} />
    </div>
  );
}
