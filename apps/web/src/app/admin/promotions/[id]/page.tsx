'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { PromotionForm, type PromotionDetail } from '@/components/admin/promotion-form';
import { Forbidden, KpiTile, PageHeader, QueryState, StatusPill } from '@/components/admin/ui';
import { Alert, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useCan } from '@/lib/session';
import { errorMessage } from '@/lib/shop';


function Inner() {
  const { id } = useParams<{ id: string }>();
  const created = useSearchParams().get('created');
  const qc = useQueryClient();
  const can = useCan('promotions.manage');
  const q = useQuery({ queryKey: ['admin-promotion', id], queryFn: () => api<PromotionDetail>(`/admin/promotions/${id}`), enabled: can });
  const act = useMutation({
    mutationFn: (a: 'pause' | 'resume' | 'end') => api<PromotionDetail>(`/admin/promotions/${id}/${a}`, { method: 'POST', body: {} }),
    onSuccess: (p) => { qc.setQueryData(['admin-promotion', id], p); qc.invalidateQueries({ queryKey: ['admin-promotions'] }); },
  });
  if (!can) return <Forbidden />;
  const p = q.data;
  return (
    <>
      <PageHeader title={p?.name ?? 'Promotion'} back={{ href: '/admin/promotions', label: 'Promotions' }}
        description={p && <span className="flex flex-wrap items-center gap-2"><StatusPill status={p.state} />{p.state === 'LIVE' && <Link href={`/sale/${p.slug}`} target="_blank" className="underline">View sale page ↗</Link>}</span>}
        actions={p && p.state !== 'ENDED' && <>
          {p.state === 'PAUSED' ? <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate('resume')}>Resume</Button>
            : <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate('pause')}>Pause</Button>}
          <Button variant="danger" onClick={() => window.confirm(`End “${p.name}” now? Prices return to normal immediately and it can’t be restarted.`) && act.mutate('end')}>End now</Button>
        </>} />
      {created && <div className="mb-4"><Alert tone="success">Promotion created.</Alert></div>}
      {act.isError && <div className="mb-4"><Alert tone="danger">{errorMessage(act.error)}</Alert></div>}
      <QueryState q={q}>
        {p && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <KpiTile label="Units sold" value={p.performance.unitsSold} hint="Net of returns, excl. cancelled" />
              <KpiTile label="Revenue" value={formatMoney(p.performance.revenue)} />
              <KpiTile label="Orders" value={p.performance.orders} />
            </div>
            <PromotionForm key={`${p.id}-${p.state}`} promo={p} onSaved={(np) => qc.setQueryData(['admin-promotion', id], np)} />
          </div>
        )}
      </QueryState>
    </>
  );
}

export default function PromotionPage() {
  return <Suspense><Inner /></Suspense>;
}
