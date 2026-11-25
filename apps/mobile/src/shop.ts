import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { api } from './api';
import { useSession } from './session';
import type { Cart } from './types';

/** The bag belongs to the account when signed in, otherwise to this device's guest id. */
export const cartKey = (userId: number | null) => ['cart', userId ?? 'guest'] as const;

export function useCart() {
  const user = useSession((s) => s.user);
  return useQuery({ queryKey: cartKey(user?.id ?? null), queryFn: () => api<Cart>('/cart'), staleTime: 15_000 });
}

export function useCartMutations() {
  const qc = useQueryClient();
  const user = useSession((s) => s.user);
  const key = cartKey(user?.id ?? null);
  const onSuccess = (c: Cart) => qc.setQueryData(key, c);
  return {
    add: useMutation({ mutationFn: (v: { variantId: number; quantity: number }) => api<Cart>('/cart/items', { method: 'POST', body: v }), onSuccess }),
    update: useMutation({ mutationFn: (v: { id: number; quantity: number }) => api<Cart>(`/cart/items/${v.id}`, { method: 'PATCH', body: { quantity: v.quantity } }), onSuccess }),
    remove: useMutation({ mutationFn: (id: number) => api<Cart>(`/cart/items/${id}`, { method: 'DELETE' }), onSuccess }),
    applyCoupon: useMutation({ mutationFn: (code: string) => api<Cart>('/cart/coupon', { method: 'POST', body: { code } }), onSuccess }),
    removeCoupon: useMutation({ mutationFn: () => api<Cart>('/cart/coupon', { method: 'DELETE' }), onSuccess }),
  };
}

export function useWishlist() {
  const qc = useQueryClient();
  const { status, user } = useSession();
  const ids = useQuery({ queryKey: ['wishlist-ids', user?.id], queryFn: () => api<number[]>('/me/wishlist/ids'), enabled: status === 'authenticated' });
  const set = new Set(ids.data ?? []);
  const toggle = useMutation({
    mutationFn: (productId: number) => (set.has(productId)
      ? api<number[]>(`/me/wishlist/items/${productId}`, { method: 'DELETE' })
      : api<number[]>('/me/wishlist/items', { method: 'POST', body: { productId } })),
    onSuccess: (next) => { qc.setQueryData(['wishlist-ids', user?.id], next); void qc.invalidateQueries({ queryKey: ['wishlist'] }); },
  });
  return {
    ids: set,
    toggle: (productId: number) => {
      if (status !== 'authenticated') { router.push('/login'); return; }
      toggle.mutate(productId);
    },
  };
}
