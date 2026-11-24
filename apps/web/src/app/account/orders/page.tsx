'use client';

import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { StatusBadge } from '@/components/order-view';
import { Alert, Button, ButtonLink, EmptyState, Skeleton } from '@/components/ui';
import { apiWithMeta } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { errorMessage } from '@/lib/shop';
import type { OrderSummary } from '@/lib/types';

export default function OrdersPage() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['my-orders', page], queryFn: () => apiWithMeta<OrderSummary[]>(`/me/orders?page=${page}&pageSize=10`), placeholderData: (prev) => prev });

  if (q.isPending) return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  const { data: orders, meta } = q.data;
  if (!orders.length) return <EmptyState title="No orders yet" body="When you place an order it will appear here with live status updates." action={<ButtonLink href="/shop?sort=newest">Start shopping</ButtonLink>} />;

  return (
    <div>
      <ul className="space-y-3">
        {orders.map((o) => (
          <li key={o.orderNumber}>
            <Link href={`/account/orders/${o.orderNumber}`} className="flex flex-wrap items-center gap-4 rounded-sm border border-line bg-paper p-4 hover:border-ink sm:flex-nowrap">
              <span className="flex -space-x-3">
                {o.previews.map((p, i) => (
                  <span key={i} className="relative h-16 w-12 overflow-hidden rounded-sm border-2 border-paper bg-sand">
                    {p.image && <Image src={p.image} alt="" fill sizes="48px" className="object-cover" />}
                  </span>
                ))}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-semibold">{o.orderNumber}</span>
                <span className="text-muted">{formatDateTime(o.placedAt)} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'}</span>
              </span>
              <StatusBadge status={o.status} />
              <span className="w-24 text-right font-semibold">{formatMoney(o.grandTotal, o.currency)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {meta && meta.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between text-sm">
          <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Newer</Button>
          <span className="text-muted">Page {meta.page} of {meta.totalPages}</span>
          <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Older</Button>
        </div>
      )}
    </div>
  );
}
