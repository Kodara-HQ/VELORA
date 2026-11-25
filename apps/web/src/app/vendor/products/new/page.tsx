'use client';

import { ProductForm } from '@/components/admin/product-form';
import { Forbidden, PageHeader } from '@/components/admin/ui';
import { useCan } from '@/lib/session';

export default function VendorNewProductPage() {
  const can = useCan('vendor_portal.products');
  if (!can) return <Forbidden />;
  return (
    <>
      <PageHeader title="Add product" back={{ href: '/vendor/products', label: 'Products' }} description="Add photos, variants and opening stock, then submit it for review." />
      <ProductForm mode="vendor" />
    </>
  );
}
