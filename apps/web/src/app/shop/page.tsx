import type { Metadata } from 'next';
import { ProductListing } from '@/components/product-listing';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shop all' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ShopPage({ searchParams }: Props) {
  const sp = await searchParams;
  const title = sp.onSale === 'true' ? 'Sale' : sp.sort === 'newest' ? 'New in' : sp.sort === 'popular' ? 'Best sellers' : 'Shop all';
  return <ProductListing title={title} eyebrow="VÉLORA" searchParams={sp} basePath="/shop" crumbs={[{ name: title, href: '/shop' }]} />;
}
