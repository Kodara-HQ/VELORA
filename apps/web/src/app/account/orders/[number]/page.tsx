'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Dialog } from '@/components/dialog';
import { OrderView } from '@/components/order-view';
import { Alert, Button, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/shop';
import type { Order } from '@/lib/types';

const REASONS = ['Ordered by mistake', 'Found a better price', 'Delivery takes too long', 'Changed my mind', 'Other'];

export default function OrderDetailPage() {
  const { number } = useParams<{ number: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['order', number], queryFn: () => api<Order>(`/me/orders/${number}`) });
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const cancel = useMutation({
    mutationFn: () => api<Order>(`/me/orders/${number}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: (o) => {
      qc.setQueryData(['order', number], o);
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
      setConfirm(false);
    },
  });

  return (
    <div>
      <Link href="/account/orders" className="mb-5 inline-block text-sm font-semibold underline underline-offset-4">← All orders</Link>
      {q.isPending ? <Skeleton className="h-96" /> : q.isError ? <Alert tone="danger">{errorMessage(q.error)}</Alert> : (
        <>
          {cancel.isSuccess && <div className="mb-4"><Alert tone="success">Your order has been cancelled. Any reserved items have been released.</Alert></div>}
          <OrderView order={q.data} actions={q.data.canCancel && <Button variant="danger" size="sm" onClick={() => setConfirm(true)}>Cancel order</Button>} />
        </>
      )}
      <Dialog open={confirm} onClose={() => setConfirm(false)} label="Cancel order" className="max-w-md">
        <div className="p-6 sm:p-8">
          <h2 className="text-xl font-extrabold">Cancel order {number}?</h2>
          <p className="mt-2 text-sm text-muted">This can’t be undone. You can place a new order any time.</p>
          <label htmlFor="reason" className="mt-5 block text-xs font-semibold uppercase tracking-[0.12em]">Reason</label>
          <select id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 h-11 w-full rounded-sm border border-line bg-paper px-3 text-sm">
            {REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
          {cancel.isError && <div className="mt-4"><Alert tone="danger">{errorMessage(cancel.error)}</Alert></div>}
          <div className="mt-6 flex gap-3">
            <Button variant="secondary" onClick={() => setConfirm(false)}>Keep order</Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel order</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
