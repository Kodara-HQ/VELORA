'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { PayNow } from '@/components/pay-now';
import { Alert, ButtonLink, Container, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/shop';

interface PaymentState {
  reference: string; status: 'INITIATED' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'ABANDONED' | 'REVERSED'; failureReason: string | null;
  orderNumber: string; orderStatus: string; orderPaymentStatus: string; paymentDueAt: string | null;
}

/**
 * Where the payment provider sends the shopper back. The URL is only a hint: the page asks our API,
 * which asks the provider. A webhook may confirm a few seconds later, so pending results are re-checked.
 */
function PaymentReturn() {
  const { number } = useParams<{ number: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const reference = params.get('reference') ?? params.get('trxref') ?? params.get('clientReference') ?? '';
  const cancelled = params.get('cancelled') === '1';
  const [tries, setTries] = useState(0);
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    try { const last = JSON.parse(sessionStorage.getItem('velora_last_order') ?? 'null'); if (last?.orderNumber === number) setEmail(last.email); } catch { /* ignore */ }
  }, [number]);

  const q = useQuery({
    queryKey: ['payment-verify', reference, tries],
    queryFn: () => api<PaymentState>('/payments/verify', { method: 'POST', body: { reference }, auth: false }),
    enabled: /^VLP[0-9A-Z]{8,40}$/.test(reference),
    retry: false,
  });
  const s = q.data;
  const pending = s && (s.status === 'PENDING' || s.status === 'INITIATED') && !cancelled;

  useEffect(() => {
    if (pending && tries < 10) {
      const t = setTimeout(() => setTries((n) => n + 1), 3000);
      return () => clearTimeout(t);
    }
  }, [pending, tries]);
  useEffect(() => {
    if (s?.status === 'SUCCESS') {
      const t = setTimeout(() => router.replace(`/order/${number}`), 1500);
      return () => clearTimeout(t);
    }
  }, [s?.status, number, router]);

  return (
    <Container className="py-16">
      <div className="mx-auto max-w-lg text-center">
        {!reference ? (
          <Alert tone="warning">We couldn’t find a payment to check. <Link href={`/order/${number}`} className="underline">View your order</Link>.</Alert>
        ) : q.isPending || (pending && tries < 10) ? (
          <>
            <Spinner className="mx-auto h-8 w-8" />
            <h1 className="mt-5 text-2xl font-extrabold">Confirming your payment…</h1>
            <p className="mt-2 text-muted">This usually takes a few seconds. Please don’t close this page.</p>
          </>
        ) : q.isError ? (
          <Alert tone="danger">{errorMessage(q.error)}</Alert>
        ) : s?.status === 'SUCCESS' ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-rose-deep">Medaase</p>
            <h1 className="mt-3 text-3xl font-extrabold">Payment received</h1>
            <p className="mt-2 text-muted">Order {number} is confirmed. Taking you to your order…</p>
            <ButtonLink href={`/order/${number}`} className="mt-6">View order</ButtonLink>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-extrabold">{cancelled ? 'Payment cancelled' : pending ? 'Still waiting for confirmation' : 'Payment not completed'}</h1>
            <p className="mt-2 text-muted">
              {pending ? 'Your provider hasn’t confirmed yet. If you approved the payment on your phone, it will update automatically. You can also try again.'
                : s?.failureReason ?? 'No money was taken.'}
            </p>
            {s?.orderStatus === 'PENDING_PAYMENT' ? (
              <div className="mt-6 text-left"><PayNow orderNumber={number} deadline={s.paymentDueAt} email={email} /></div>
            ) : (
              <ButtonLink href={`/order/${number}`} className="mt-6">View order</ButtonLink>
            )}
          </>
        )}
      </div>
    </Container>
  );
}

export default function PaymentReturnPage() {
  return <Suspense><PaymentReturn /></Suspense>;
}
