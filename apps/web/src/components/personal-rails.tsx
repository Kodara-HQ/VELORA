'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { ProductCard } from '@/lib/types';
import { ProductRail } from './product-card';

/** Personalised rails: need the shopper's identity, so they load in the browser after the page renders. */
export function RecentlyViewedRail({ excludeId, title = 'Recently viewed' }: { excludeId?: number; title?: string }) {
  const { status, user } = useSession();
  const q = useQuery({
    queryKey: ['recently-viewed', user?.id],
    queryFn: () => api<ProductCard[]>('/recently-viewed'),
    enabled: status !== 'loading',
  });
  const items = (q.data ?? []).filter((p) => p.id !== excludeId);
  return <ProductRail title={title} eyebrow="Pick up where you left off" products={items} />;
}

export function RecommendedRail() {
  const { status, user } = useSession();
  const q = useQuery({
    queryKey: ['recommendations', user?.id],
    queryFn: () => api<ProductCard[]>('/recommendations'),
    enabled: status !== 'loading',
  });
  return <ProductRail title={user ? `Picked for you, ${user.firstName}` : 'Recommended for you'} eyebrow="Based on your browsing" products={q.data ?? []} />;
}

/** Records a product view (powers recently viewed and recommendations). */
export function TrackView({ productId }: { productId: number }) {
  const status = useSession((s) => s.status);
  useEffect(() => {
    if (status === 'loading') return;
    void api(`/products/${productId}/views`, { method: 'POST', body: {} }).catch(() => undefined);
  }, [productId, status]);
  return null;
}
