'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { create } from 'zustand';
import { api, ApiError } from './api';
import { useSession } from './session';
import type { Cart } from './types';

/* ─────────── UI state ─────────── */

interface UiState {
  cartOpen: boolean;
  cartNotice: string | null;
  quickView: string | null;
  openCart: (notice?: string | null) => void;
  closeCart: () => void;
  openQuickView: (slug: string) => void;
  closeQuickView: () => void;
}

export const useUi = create<UiState>((set) => ({
  cartOpen: false,
  cartNotice: null,
  quickView: null,
  openCart: (notice = null) => set({ cartOpen: true, cartNotice: notice, quickView: null }),
  closeCart: () => set({ cartOpen: false, cartNotice: null }),
  openQuickView: (slug) => set({ quickView: slug }),
  closeQuickView: () => set({ quickView: null }),
}));

/* ─────────── Cart ─────────── */

export const cartKey = (userId: number | null) => ['cart', userId ?? 'guest'] as const;

export function useCart() {
  const { status, user } = useSession();
  return useQuery({
    queryKey: cartKey(user?.id ?? null),
    queryFn: () => api<Cart>('/cart'),
    enabled: status !== 'loading',
    staleTime: 10_000,
  });
}

export function useCartMutations() {
  const qc = useQueryClient();
  const userId = useSession((s) => s.user?.id ?? null);
  const openCart = useUi((s) => s.openCart);
  const set = (cart: Cart) => qc.setQueryData(cartKey(userId), cart);

  const add = useMutation({
    mutationFn: (v: { variantId: number; quantity: number }) => api<Cart>('/cart/items', { method: 'POST', body: v }),
    onSuccess: (cart) => {
      set(cart);
      openCart(cart.notice ?? null);
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: number; quantity: number }) => api<Cart>(`/cart/items/${v.id}`, { method: 'PATCH', body: { quantity: v.quantity } }),
    onSuccess: set,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<Cart>(`/cart/items/${id}`, { method: 'DELETE' }),
    onSuccess: set,
  });
  const applyCoupon = useMutation({
    mutationFn: (code: string) => api<Cart>('/cart/coupon', { method: 'POST', body: { code } }),
    onSuccess: set,
  });
  const removeCoupon = useMutation({
    mutationFn: () => api<Cart>('/cart/coupon', { method: 'DELETE' }),
    onSuccess: set,
  });
  return { add, update, remove, applyCoupon, removeCoupon };
}

/* ─────────── Wishlist ─────────── */

export function useWishlist() {
  const { status, user } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const ids = useQuery({
    queryKey: ['wishlist-ids', user?.id],
    queryFn: () => api<number[]>('/me/wishlist/ids'),
    enabled: status === 'authenticated',
    staleTime: 60_000,
  });
  const toggle = useMutation({
    mutationFn: (productId: number) => {
      const has = ids.data?.includes(productId);
      return has
        ? api<number[]>(`/me/wishlist/items/${productId}`, { method: 'DELETE' })
        : api<number[]>('/me/wishlist/items', { method: 'POST', body: { productId } });
    },
    onSuccess: (next) => {
      qc.setQueryData(['wishlist-ids', user?.id], next);
      void qc.invalidateQueries({ queryKey: ['wishlist'] });
    },
  });
  return {
    ids: new Set(ids.data ?? []),
    count: ids.data?.length ?? 0,
    toggle: (productId: number) => {
      if (status !== 'authenticated') {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      toggle.mutate(productId);
    },
    pending: toggle.isPending ? toggle.variables : null,
  };
}

export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : e ? 'Something went wrong. Please try again.' : null);
