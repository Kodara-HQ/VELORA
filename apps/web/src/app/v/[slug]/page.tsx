import type { Metadata } from 'next';
import { ProductListing } from '@/components/product-listing';
import { serverApi } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface Shop { name: string; slug: string; description: string | null; logoUrl: string | null; since: string; rating: number; reviewCount: number; productCount: number }
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await serverApi<Shop>(`/vendors/${slug}`, { notFoundOn404: true });
  return { title: `${data.name} on VÉLORA`, description: data.description ?? `Shop ${data.name} on VÉLORA.` };
}

export default async function ShopPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const { data: shop } = await serverApi<Shop>(`/vendors/${slug}`, { notFoundOn404: true });
  const since = new Date(shop.since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return (
    <ProductListing
      title={shop.name}
      eyebrow="VÉLORA Marketplace seller"
      intro={[shop.description, `${shop.productCount} pieces`, shop.reviewCount ? `★ ${shop.rating.toFixed(1)} from ${shop.reviewCount} reviews` : null, `Selling since ${since}`].filter(Boolean).join(' · ')}
      vendor={slug}
      searchParams={sp}
      basePath={`/v/${slug}`}
      crumbs={[{ name: shop.name, href: `/v/${slug}` }]}
    />
  );
}
