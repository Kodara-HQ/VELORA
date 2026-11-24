'use client';

import { useState, type FormEvent } from 'react';
import { RecommendedRail } from '@/components/personal-rails';
import { CartLineRow, Row } from '@/components/shop-overlays';
import { Alert, Button, ButtonLink, Container, EmptyState, Skeleton } from '@/components/ui';
import { formatMoney } from '@/lib/format';
import { errorMessage, useCart, useCartMutations } from '@/lib/shop';

export default function CartPage() {
  const cart = useCart();
  const { applyCoupon, removeCoupon } = useCartMutations();
  const [code, setCode] = useState('');
  const data = cart.data;

  const onCoupon = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim()) applyCoupon.mutate(code.trim(), { onSuccess: () => setCode('') });
  };

  return (
    <Container className="py-10">
      <h1 className="text-3xl font-extrabold sm:text-4xl">Your bag</h1>
      {cart.isPending ? (
        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]"><Skeleton className="h-80" /><Skeleton className="h-64" /></div>
      ) : cart.isError ? (
        <div className="mt-8"><Alert tone="danger">{errorMessage(cart.error)}</Alert></div>
      ) : !data?.items.length ? (
        <>
          <EmptyState title="Your bag is empty" body="Discover new arrivals and best sellers, then come back here to check out."
            action={<ButtonLink href="/shop?sort=newest">Start shopping</ButtonLink>} />
          <RecommendedRail />
        </>
      ) : (
        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
          <div>
            {data.hasIssues && <Alert tone="warning" title="Some items need attention">Update or remove the highlighted items before checking out.</Alert>}
            <ul className="divide-y divide-line border-b border-line">{data.items.map((l) => <CartLineRow key={l.id} line={l} />)}</ul>
          </div>
          <aside className="h-fit space-y-4 rounded-sm border border-line bg-paper p-6 lg:sticky lg:top-40">
            <h2 className="text-lg font-extrabold">Order summary</h2>
            {data.coupon ? (
              <div className={`flex items-start justify-between gap-3 rounded-sm border px-3 py-2 text-sm ${data.coupon.valid ? 'border-success/30 bg-success-soft' : 'border-danger/30 bg-danger-soft'}`}>
                <div>
                  <p className="font-semibold">{data.coupon.code}</p>
                  <p className="text-xs">{data.coupon.valid ? data.coupon.description : data.coupon.reason}</p>
                </div>
                <button type="button" onClick={() => removeCoupon.mutate()} className="text-xs font-semibold underline">Remove</button>
              </div>
            ) : (
              <form onSubmit={onCoupon} className="space-y-2">
                <label htmlFor="coupon" className="text-xs font-semibold uppercase tracking-[0.12em]">Promo code</label>
                <div className="flex gap-2">
                  <input id="coupon" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. AKWAABA10" autoComplete="off"
                    className="h-11 min-w-0 flex-1 rounded-sm border border-line px-3 text-sm uppercase focus:border-ink focus:outline-none" />
                  <Button type="submit" variant="secondary" loading={applyCoupon.isPending}>Apply</Button>
                </div>
                {applyCoupon.isError && <p role="alert" className="text-xs text-danger">{errorMessage(applyCoupon.error)}</p>}
              </form>
            )}
            <div className="space-y-2 border-t border-line pt-4">
              <Row label={`Subtotal (${data.itemCount} item${data.itemCount === 1 ? '' : 's'})`} value={formatMoney(data.subtotal)} />
              {Number(data.discountTotal) > 0 && <Row label="Discount" value={`−${formatMoney(data.discountTotal)}`} accent />}
              <Row label="Delivery" value="At checkout" />
              <div className="border-t border-line pt-3"><Row label="Estimated total" value={formatMoney(data.estimatedTotal)} strong /></div>
            </div>
            {data.hasIssues
              ? <Button size="lg" block disabled>Checkout</Button>
              : <ButtonLink href="/checkout" size="lg" block>Checkout</ButtonLink>}
            <p className="text-center text-xs text-muted">Pay cash or MoMo on delivery. Secure online payment coming soon.</p>
          </aside>
        </div>
      )}
    </Container>
  );
}
