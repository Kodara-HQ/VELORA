'use client';

import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { OrderView } from '@/components/order-view';
import { Alert, Button, Container, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { Order } from '@/lib/types';

function TrackForm() {
  const params = useSearchParams();
  const [orderNumber, setOrderNumber] = useState(params.get('order') ?? '');
  const [email, setEmail] = useState('');
  const m = useMutation({ mutationFn: () => api<Order>('/orders/lookup', { method: 'POST', auth: false, body: { orderNumber: orderNumber.trim().toUpperCase(), email } }) });
  const err = m.error instanceof ApiError ? m.error : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };

  if (m.data) {
    return (
      <>
        <OrderView order={m.data} />
        <Button variant="ghost" className="mt-6" onClick={() => m.reset()}>Track another order</Button>
      </>
    );
  }
  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex max-w-md flex-col gap-5">
      {err && <Alert tone="danger">{err.message}</Alert>}
      <Field label="Order number" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="VL2611241A2B3" required error={err?.fieldErrors.orderNumber} />
      <Field label="Email used at checkout" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required error={err?.fieldErrors.email} />
      <Button type="submit" size="lg" block loading={m.isPending}>Track order</Button>
      <p className="text-center text-sm text-muted">Have an account? Your orders are under <a href="/account/orders" className="underline">My orders</a>.</p>
    </form>
  );
}

export default function TrackOrderPage() {
  return (
    <Container className="py-10">
      <div className="mx-auto mb-8 max-w-md text-center">
        <h1 className="text-3xl font-extrabold">Track your order</h1>
        <p className="mt-2 text-muted">Enter the order number from your confirmation email.</p>
      </div>
      <Suspense><TrackForm /></Suspense>
    </Container>
  );
}
