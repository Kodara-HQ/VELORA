import Image from 'next/image';
import Link from 'next/link';
import { RecentlyViewedRail, RecommendedRail } from '@/components/personal-rails';
import { ProductRail, Stars } from '@/components/product-card';
import { NewsletterForm } from '@/components/newsletter';
import { ShieldIcon, TruckIcon, ReturnIcon } from '@/components/icons';
import { ButtonLink, Container } from '@/components/ui';
import { serverApi } from '@/lib/server-api';
import { FlashSaleBand } from '@/components/flash-sale';
import type { LiveSale } from '@/lib/types';
import type { ProductCard } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface HomeFeed {
  categories: Array<{ name: string; slug: string; imageUrl: string | null }>;
  newArrivals: ProductCard[];
  bestSellers: ProductCard[];
  onSale: ProductCard[];
  featured: ProductCard[];
  brands: Array<{ name: string; slug: string }>;
  reviews: Array<{ id: number; rating: number; title: string | null; body: string; author: string; product: { name: string; slug: string; image: string | null } }>;
}

const TILE_TONES = ['bg-rose-soft', 'bg-sand', 'bg-paper'];

export default async function HomePage() {
  const [{ data }, { data: sales }] = await Promise.all([
    serverApi<HomeFeed>('/storefront/home'),
    serverApi<LiveSale[]>('/promotions/live').catch(() => ({ data: [] as LiveSale[] })),
  ]);
  const hero = data.featured[0];

  return (
    <>
      {/* Editorial hero */}
      <section className="border-b border-line">
        <Container className="grid gap-8 py-10 sm:py-14 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-14">
          <div className="animate-fade-up">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-rose-deep">The new season edit</p>
            <h1 className="mt-5 text-display font-extrabold">DEFINE<br />YOUR STYLE.</h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-muted">
              Considered pieces from Ghanaian ateliers and international labels. Delivered across Ghana, paid on delivery.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/shop?sort=newest" size="lg">Shop new in</ButtonLink>
              <ButtonLink href="/shop?onSale=true" size="lg" variant="secondary">Shop the sale</ButtonLink>
            </div>
          </div>
          {hero?.image && (
            <Link href={`/p/${hero.slug}`} className="group relative block aspect-[4/5] overflow-hidden rounded-sm bg-sand animate-fade-up [animation-delay:120ms]">
              <Image src={hero.image.url} alt={hero.image.alt} fill priority sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover transition duration-700 group-hover:scale-[1.02]" />
              <span className="absolute bottom-4 left-4 rounded-sm bg-paper/95 px-4 py-3 text-sm">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-deep">Featured</span>
                <span className="font-semibold">{hero.name}</span>
              </span>
            </Link>
          )}
        </Container>
      </section>

      {/* Service promises */}
      <section aria-label="Why shop with VÉLORA" className="border-b border-line bg-paper">
        <Container className="grid grid-cols-1 divide-y divide-line text-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { icon: TruckIcon, t: 'Delivery across all 16 regions', d: 'Same-day in Accra' },
            { icon: ShieldIcon, t: 'Pay on delivery', d: 'Cash or MoMo to the rider' },
            { icon: ReturnIcon, t: '14-day returns', d: 'Easy exchanges on sizing' },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="flex items-center justify-center gap-3 px-4 py-4">
              <Icon className="shrink-0 text-rose-deep" />
              <p><span className="font-semibold">{t}</span> <span className="text-muted">· {d}</span></p>
            </div>
          ))}
        </Container>
      </section>

      <Container>
        {/* Departments */}
        <section aria-labelledby="dept" className="pt-12 sm:pt-16">
          <h2 id="dept" className="text-2xl font-extrabold sm:text-3xl">Shop by department</h2>
          <ul className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3 lg:grid-cols-9">
            {data.categories.map((c, i) => (
              <li key={c.slug}>
                <Link href={`/c/${c.slug}`} className={`group flex aspect-[3/4] flex-col justify-end rounded-sm p-3 transition hover:bg-ink hover:text-paper ${TILE_TONES[i % 3]} border border-line`}>
                  <span className="font-display text-sm font-bold leading-tight sm:text-base">{c.name}</span>
                  <span className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] opacity-0 transition group-hover:opacity-100">Shop →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <FlashSaleBand sales={sales} />

        <ProductRail eyebrow="Just landed" title="New arrivals" href="/shop?sort=newest" products={data.newArrivals} />

        {data.onSale.length > 0 && (
          <section className="my-4 grid overflow-hidden rounded-sm bg-rose lg:grid-cols-[1fr_2fr]">
            <div className="flex flex-col justify-center p-8 sm:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.3em]">Limited time</p>
              <h2 className="mt-3 font-display text-4xl font-extrabold leading-[0.95] sm:text-5xl">The<br />Sale Edit</h2>
              <p className="mt-4 max-w-xs text-sm">Reduced pieces while stock lasts. When they’re gone, they’re gone.</p>
              <ButtonLink href="/shop?onSale=true" className="mt-6 self-start">Shop all sale</ButtonLink>
            </div>
            <ul className="grid grid-cols-2 gap-px bg-rose sm:grid-cols-4">
              {data.onSale.slice(0, 4).map((p) => (
                <li key={p.id} className="bg-rose-soft">
                  <Link href={`/p/${p.slug}`} className="group block p-3">
                    <span className="relative block aspect-[3/4] overflow-hidden rounded-sm bg-sand">
                      {p.image && <Image src={p.image.url} alt={p.image.alt} fill sizes="(min-width: 1024px) 15vw, 45vw" className="object-cover transition group-hover:scale-[1.03]" />}
                    </span>
                    <span className="mt-2 block truncate text-sm font-medium">{p.name}</span>
                    <span className="text-sm"><b className="text-rose-deep">GH₵{p.price}</b> <s className="text-muted">GH₵{p.compareAtPrice}</s></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <ProductRail eyebrow="Most loved" title="Best sellers" href="/shop?sort=popular" products={data.bestSellers} />
        <RecommendedRail />

        {data.brands.length > 0 && (
          <section aria-labelledby="brands" className="py-10">
            <h2 id="brands" className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-muted">Featured labels</h2>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
              {data.brands.map((b) => (
                <li key={b.slug}>
                  <Link href={`/search?q=${encodeURIComponent(b.name)}`} className="font-display text-xl font-extrabold tracking-tight text-ink/80 hover:text-ink sm:text-2xl">{b.name}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <RecentlyViewedRail />

        {data.reviews.length > 0 && (
          <section aria-labelledby="reviews" className="py-12">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-rose-deep">In their words</p>
            <h2 id="reviews" className="mt-1 text-2xl font-extrabold sm:text-3xl">What our customers say</h2>
            <ul className="mt-6 grid gap-4 md:grid-cols-3">
              {data.reviews.slice(0, 3).map((r) => (
                <li key={r.id} className="flex flex-col rounded-sm border border-line bg-paper p-6">
                  <Stars rating={r.rating} />
                  {r.title && <p className="mt-3 font-semibold">{r.title}</p>}
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">“{r.body}”</p>
                  <Link href={`/p/${r.product.slug}`} className="mt-5 flex items-center gap-3 border-t border-line pt-4 text-sm">
                    <span className="relative h-12 w-9 shrink-0 overflow-hidden rounded-sm bg-sand">
                      {r.product.image && <Image src={r.product.image} alt="" fill sizes="36px" className="object-cover" />}
                    </span>
                    <span><span className="font-medium">{r.author}</span><span className="block text-xs text-muted">on {r.product.name}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-6 grid gap-6 rounded-sm bg-ink p-8 text-paper sm:p-12 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="font-display text-3xl font-extrabold sm:text-4xl">Be first to the drop.</h2>
            <p className="mt-3 text-paper/70">New arrivals, members-only offers and styling notes. No spam, unsubscribe any time.</p>
          </div>
          <NewsletterForm dark />
        </section>
      </Container>
    </>
  );
}
