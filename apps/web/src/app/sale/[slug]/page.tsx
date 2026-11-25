import type { Metadata } from 'next';
import { Countdown } from '@/components/countdown';
import { ProductListing } from '@/components/product-listing';
import { Container } from '@/components/ui';
import { serverApi } from '@/lib/server-api';

export const dynamic = 'force-dynamic';

interface Sale { name: string; slug: string; type: string; headline: string | null; bannerUrl: string | null; startsAt: string; endsAt: string; state: 'LIVE' | 'SCHEDULED' | 'ENDED' | 'PAUSED'; value: string | null }
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { data } = await serverApi<Sale>(`/promotions/${slug}`, { notFoundOn404: true });
  return { title: data.name, description: data.headline ?? `${data.name} at VÉLORA` };
}

export default async function SalePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const { data: sale } = await serverApi<Sale>(`/promotions/${slug}`, { notFoundOn404: true });
  if (sale.state !== 'LIVE') {
    return (
      <Container className="py-20 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-rose-deep">{sale.state === 'SCHEDULED' ? 'Coming soon' : 'Sale over'}</p>
        <h1 className="mt-3 font-display text-4xl font-extrabold sm:text-5xl">{sale.name}</h1>
        {sale.headline && <p className="mt-3 text-muted">{sale.headline}</p>}
        {sale.state === 'SCHEDULED'
          ? <p className="mt-8 text-lg">Starts in <Countdown to={sale.startsAt} className="font-display text-3xl font-extrabold" /></p>
          : <p className="mt-8 text-muted">This sale has ended. <a href="/shop?onSale=true" className="font-semibold text-ink underline">See what’s on sale now</a>.</p>}
      </Container>
    );
  }
  return (
    <ProductListing
      title={sale.name}
      eyebrow={sale.type === 'FLASH_SALE' ? 'Flash sale' : 'Sale'}
      intro={sale.headline ?? undefined}
      promotion={slug}
      searchParams={sp}
      basePath={`/sale/${slug}`}
      crumbs={[{ name: 'Sale', href: '/shop?onSale=true' }, { name: sale.name, href: `/sale/${slug}` }]}
      banner={
        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm bg-ink px-5 py-4 text-paper">
          <span className="text-xs font-semibold uppercase tracking-[0.25em] text-rose">Ends in</span>
          <Countdown to={sale.endsAt} className="font-display text-3xl font-extrabold" />
          <span className="text-sm text-paper/70">Prices shown include the discount. Limited quantities at sale prices.</span>
        </div>
      }
    />
  );
}
