import type { Metadata } from 'next';
import { ProductListing } from '@/components/product-listing';
import { serverApi } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface CategoryInfo {
  name: string;
  slug: string;
  parent: { name: string; slug: string } | null;
  children: Array<{ name: string; slug: string }>;
  siblings: Array<{ name: string; slug: string }>;
}

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await serverApi<CategoryInfo>(`/categories/${slug}`, { notFoundOn404: true });
  return { title: data.parent ? `${data.name} · ${data.parent.name}` : data.name, description: `Shop ${data.name} at VÉLORA. Delivered across Ghana.` };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const { data: cat } = await serverApi<CategoryInfo>(`/categories/${slug}`, { notFoundOn404: true });
  const parent = cat.parent;
  const subnav = parent
    ? [{ name: `All ${parent.name}`, href: `/c/${parent.slug}` }, ...cat.siblings.map((s) => ({ name: s.name, href: `/c/${s.slug}`, active: s.slug === cat.slug }))]
    : cat.children.map((c) => ({ name: c.name, href: `/c/${c.slug}` }));

  return (
    <ProductListing
      title={cat.name}
      eyebrow={parent?.name}
      category={slug}
      searchParams={sp}
      basePath={`/c/${slug}`}
      crumbs={[...(parent ? [{ name: parent.name, href: `/c/${parent.slug}` }] : []), { name: cat.name, href: `/c/${cat.slug}` }]}
      subnav={subnav}
    />
  );
}
