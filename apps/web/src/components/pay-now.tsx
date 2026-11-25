'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/shop';
import type { NextAction, PaymentMethodOption } from '@/lib/types';
import { Alert, Button } from './ui';

/** Time left to pay, as "12:34". */
export function useCountdown(deadline: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);
  if (!deadline) return null;
  const ms = Math.max(0, new Date(deadline).getTime() - now);
  return { expired: ms === 0, label: `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}` };
}

/** "Complete payment" for an order awaiting online payment. Guests prove ownership with their checkout email. */
export function PayNow({ orderNumber, deadline, email }: { orderNumber: string; deadline: string | null; email?: string | null }) {
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api<PaymentMethodOption[]>('/checkout/payment-methods', { auth: false }), staleTime: 300_000 });
  const online = (methods.data ?? []).filter((m) => m.online);
  const [provider, setProvider] = useState('');
  useEffect(() => { if (online.length && !provider) setProvider(online[0].code); }, [online, provider]);
  const countdown = useCountdown(deadline);
  const pay = useMutation({
    mutationFn: () => api<NextAction>(`/orders/${orderNumber}/pay`, { method: 'POST', body: { provider, ...(email && { email }) } }),
    onSuccess: (a) => window.location.assign(a.url),
  });

  if (countdown?.expired) return <Alert tone="warning" title="Payment window closed">This order will be cancelled shortly and its items released.</Alert>;
  return (
    <div className="rounded-sm border border-rose bg-rose-soft p-4">
      <p className="font-semibold">Payment needed to confirm this order</p>
      {countdown && <p className="mt-1 text-sm">Your items are held for <b aria-live="polite">{countdown.label}</b> more minutes.</p>}
      {pay.isError && <div className="mt-3"><Alert tone="danger">{errorMessage(pay.error)}</Alert></div>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {online.length > 1 && (
          <select aria-label="Payment method" value={provider} onChange={(e) => setProvider(e.target.value)} className="h-11 rounded-sm border border-line bg-paper px-3 text-sm">
            {online.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        )}
        <Button onClick={() => pay.mutate()} loading={pay.isPending} disabled={!provider}>Complete payment</Button>
      </div>
    </div>
  );
}
