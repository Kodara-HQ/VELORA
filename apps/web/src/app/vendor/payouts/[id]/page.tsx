'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { PageHeader, QueryState } from '@/components/admin/ui';
import { SettlementView, type SettlementDetail } from '@/components/settlement-view';
import { api } from '@/lib/api';

export default function VendorStatementPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['vendor-settlement', id], queryFn: () => api<SettlementDetail>(`/vendor/settlements/${id}`) });
  return (
    <>
      <PageHeader title={q.data ? `Statement ${q.data.reference}` : 'Statement'} back={{ href: '/vendor/payouts', label: 'Earnings & payouts' }}
        description={q.data?.status === 'PAID' ? 'Paid. Keep the reference for your records.' : q.data?.status === 'APPROVED' ? 'Approved. Payment is on its way.' : q.data ? 'Being prepared by VÉLORA finance.' : undefined} />
      <QueryState q={q}>{q.data && <SettlementView s={q.data} orderHref={(n) => `/vendor/orders/${n}`} />}</QueryState>
    </>
  );
}
