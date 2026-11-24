'use client';

import { ProductForm } from '@/components/admin/product-form';
import { Forbidden, PageHeader } from '@/components/admin/ui';
import { useCan } from '@/lib/session';

export default function NewProductPage() {
  const can = useCan('products.create');
  if (!can) return <Forbidden />;
  return (
    <>
      <PageHeader title="Add product" back={{ href: '/admin/products', label: 'Products' }} description="Saved as a draft until you set it Active." />
      <ProductForm />
    </>
  );
}
