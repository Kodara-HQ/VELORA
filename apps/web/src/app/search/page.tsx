import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ProductListing } from '@/components/product-listing';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const q = (await searchParams).q;
  return { title: typeof q === 'string' ? `Search: ${q}` : 'Search', robots: { index: false } };
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim().slice(0, 100) : '';
  if (!q) redirect('/shop');
  return <ProductListing title={`“${q}”`} eyebrow="Search results" q={q} searchParams={sp} basePath="/search" />;
}
