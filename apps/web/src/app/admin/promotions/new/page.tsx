'use client';

import { PromotionForm } from '@/components/admin/promotion-form';
import { Forbidden, PageHeader } from '@/components/admin/ui';
import { useCan } from '@/lib/session';

export default function NewPromotionPage() {
  const can = useCan('promotions.manage');
  if (!can) return <Forbidden />;
  return (
    <>
      <PageHeader title="New promotion" back={{ href: '/admin/promotions', label: 'Promotions' }} description="Pick products, set the discount and when it runs." />
      <PromotionForm />
    </>
  );
}
