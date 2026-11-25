'use client';

import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert, Button, Container } from '@/components/ui';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { formatMoney } from '@/lib/format';
import { errorMessage } from '@/lib/shop';

/**
 * Development stand-in for a hosted checkout (Paystack / Hubtel). The API only enables it when
 * PAYMENT_SIMULATOR=true and refuses that setting in production, so this page can't take payments there.
 */
function Simulator() {
  const p = useSearchParams();
  const reference = p.get('reference') ?? '';
  const callback = p.get('callback') ?? '/';
  const [channel, setChannel] = useState<'card' | 'momo'>('momo');
  const decide = useMutation({
    mutationFn: (outcome: 'approve' | 'decline') => api(`/payments/simulator/${reference}`, { method: 'POST', body: { outcome, channel }, auth: false }),
    // Only follow same-origin callbacks.
    onSuccess: () => window.location.assign(new URL(callback, window.location.origin).origin === window.location.origin ? callback : '/'),
  });

  return (
    <Container className="py-16">
      <div className="mx-auto max-w-md rounded-md border-2 border-dashed border-warning bg-paper p-8">
        <p className="rounded-sm bg-warning-soft px-3 py-2 text-xs font-semibold text-warning">Development payment simulator. No real money moves.</p>
        <p className="mt-6 text-xs uppercase tracking-[0.2em] text-muted">Pay VÉLORA</p>
        <p className="mt-1 font-display text-4xl font-extrabold">{formatMoney(p.get('amount') ?? '0')}</p>
        <p className="mt-1 text-sm text-muted">Order {p.get('order')} · Ref {reference}</p>
        <fieldset className="mt-6">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em]">Pay with</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['momo', 'card'] as const).map((c) => (
              <button key={c} type="button" onClick={() => setChannel(c)} aria-pressed={channel === c}
                className={cx('rounded-sm border px-3 py-3 text-sm font-medium', channel === c ? 'border-ink bg-ink text-paper' : 'border-line')}>
                {c === 'momo' ? 'MTN MoMo' : 'Visa card'}
              </button>
            ))}
          </div>
        </fieldset>
        {decide.isError && <div className="mt-4"><Alert tone="danger">{errorMessage(decide.error)}</Alert></div>}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => decide.mutate('decline')} loading={decide.isPending && decide.variables === 'decline'}>Decline</Button>
          <Button onClick={() => decide.mutate('approve')} loading={decide.isPending && decide.variables === 'approve'}>Approve</Button>
        </div>
      </div>
    </Container>
  );
}

export default function PaySimulatorPage() {
  return <Suspense><Simulator /></Suspense>;
}
