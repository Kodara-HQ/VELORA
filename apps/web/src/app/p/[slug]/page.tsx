import type { Metadata } from 'next';
import Link from 'next/link';
import { RecentlyViewedRail, TrackView } from '@/components/personal-rails';
import { ProductRail } from '@/components/product-card';
import { ProductDetails, ProductHero, Reviews } from '@/components/product-page';
import { Container } from '@/components/ui';
import { serverApi } from '@/lib/server-api';
import type { ProductCard, ProductDetail } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { data: p } = await serverApi<ProductDetail>(`/products/${slug}`, { notFoundOn404: true });
  return {
    title: p.name,
    description: p.shortDescription ?? undefined,
    openGraph: { title: p.name, description: p.shortDescription ?? undefined, images: p.images[0] ? [p.images[0].url] : [] },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [{ data: product }, { data: related }] = await Promise.all([
    serverApi<ProductDetail>(`/products/${slug}`, { notFoundOn404: true }),
    serverApi<{ similar: ProductCard[]; completeTheLook: ProductCard[] }>(`/products/${slug}/related`, { notFoundOn404: true }),
  ]);
  const inStock = product.variants.some((v) => v.available > 0);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    sku: product.styleCode,
    brand: product.brand ? { '@type': 'Brand', name: product.brand.name } : undefined,
    image: product.images.map((i) => i.url),
    description: product.shortDescription,
    ...(product.reviewCount > 0 && { aggregateRating: { '@type': 'AggregateRating', ratingValue: product.rating, reviewCount: product.reviewCount } }),
    offers: { '@type': 'Offer', priceCurrency: product.currency, price: product.price, availability: `https://schema.org/${inStock ? 'InStock' : 'OutOfStock'}` },
  };

  return (
    <Container className="py-6 sm:py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <TrackView productId={product.id} />
      <nav aria-label="Breadcrumb" className="mb-5 text-xs text-muted">
        <ol className="flex flex-wrap gap-1.5">
          <li><Link href="/" className="hover:text-ink">Home</Link></li>
          {product.breadcrumbs.map((b) => <li key={b.slug} className="before:mr-1.5 before:content-['/']"><Link href={`/c/${b.slug}`} className="hover:text-ink">{b.name}</Link></li>)}
          <li className="text-ink before:mr-1.5 before:text-muted before:content-['/']" aria-current="page">{product.name}</li>
        </ol>
      </nav>

      <ProductHero product={product} />

      <div className="mt-14 max-w-3xl">
        <ProductDetails product={product} />
      </div>

      <ProductRail eyebrow="Complete the look" title="Wear it with" products={related.completeTheLook} />
      <Reviews product={product} />
      <ProductRail eyebrow="You may also like" title="Similar pieces" products={related.similar} />
      <RecentlyViewedRail excludeId={product.id} />
    </Container>
  );
}
