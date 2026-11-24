'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { OrderView } from '@/components/order-view';
import { Alert, ButtonLink, Container, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/shop';
import type { Order } from '@/lib/types';

/** Order confirmation. Members load it from their account; guests via the order number + email saved at checkout. */
export default function OrderConfirmationPage() {
  const { number } = useParams<{ number: string }>();
  const { status } = useSession();
  const [guestEmail, setGuestEmail] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    try {
      const last = JSON.parse(sessionStorage.getItem('velora_last_order') ?? 'null');
      setGuestEmail(last?.orderNumber === number ? last.email : null);
    } catch {
      setGuestEmail(null);
    }
  }, [number]);

  const q = useQuery({
    queryKey: ['order', number],
    queryFn: () => status === 'authenticated'
      ? api<Order>(`/me/orders/${number}`)
      : api<Order>('/orders/lookup', { method: 'POST', body: { orderNumber: number, email: guestEmail } }),
    enabled: status === 'authenticated' || (status === 'anonymous' && !!guestEmail),
  });

  const needsLookup = status === 'anonymous' && guestEmail === null;

  return (
    <Container className="py-10">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-rose-deep">Medaase · Thank you</p>
        <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">Your order is confirmed</h1>
        <p className="mt-3 text-muted">
          Order <b className="text-ink">{number}</b>. We’ll text and email you when it’s on its way.
        </p>
      </div>
      {needsLookup ? (
        <div className="mx-auto max-w-md text-center">
          <p className="text-muted">To see the details of this order, look it up with the email you used at checkout.</p>
          <ButtonLink href={`/track-order?order=${number}`} className="mt-5">Track this order</ButtonLink>
        </div>
      ) : q.isPending ? (
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]"><Skeleton className="h-96" /><Skeleton className="h-72" /></div>
      ) : q.isError ? (
        <Alert tone="danger">{errorMessage(q.error)}</Alert>
      ) : (
        <>
          <OrderView order={q.data} />
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/shop?sort=newest">Continue shopping</ButtonLink>
            {status === 'authenticated' && <ButtonLink href="/account/orders" variant="secondary">View my orders</ButtonLink>}
            {status === 'anonymous' && <ButtonLink href="/register" variant="secondary">Create an account to track orders</ButtonLink>}
          </div>
        </>
      )}
    </Container>
  );
}
