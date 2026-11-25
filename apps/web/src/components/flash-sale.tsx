'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { LiveSale, PromoBadge } from '@/lib/types';
import { Countdown } from './countdown';
import { ProductCard } from './product-card';

const kind = (t: PromoBadge['type']) => (t === 'FLASH_SALE' ? 'Flash sale' : 'Sale');

/** Home page band for the top live sale (with its countdown) and a teaser for the next flash sale. */
export function FlashSaleBand({ sales }: { sales: LiveSale[] }) {
  const router = useRouter();
  const live = sales.find((s) => s.state === 'LIVE' && s.products.length);
  const next = sales.find((s) => s.state === 'SCHEDULED');
  if (!live && !next) return null;
  return (
    <section aria-label={live ? live.name : 'Upcoming sale'} className="my-10">
      {live && (
        <div className="overflow-hidden rounded-sm bg-ink text-paper">
          <div className="flex flex-wrap items-end justify-between gap-4 px-6 pb-4 pt-6 sm:px-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-rose">{kind(live.type)} · ends in</p>
              <Countdown to={live.endsAt} onDone={() => router.refresh()} className="mt-1 block font-display text-4xl font-extrabold sm:text-5xl" />
              <h2 className="mt-2 text-xl font-extrabold">{live.name}</h2>
              {live.headline && <p className="text-sm text-paper/70">{live.headline}</p>}
            </div>
            <Link href={`/sale/${live.slug}`} className="rounded-sm bg-paper px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink hover:bg-rose">Shop the sale</Link>
          </div>
          <ul className="flex snap-x gap-3 overflow-x-auto bg-paper px-4 py-5 text-ink sm:grid sm:grid-cols-3 sm:gap-5 sm:px-8 lg:grid-cols-6 [&::-webkit-scrollbar]:hidden">
            {live.products.slice(0, 6).map((p) => (
              <li key={p.id} className="w-[42vw] shrink-0 snap-start sm:w-auto"><ProductCard product={p} /></li>
            ))}
          </ul>
        </div>
      )}
      {next && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 rounded-sm border border-line bg-paper px-5 py-3 text-sm">
          <b>Coming soon: {next.name}</b>{next.headline && <span className="text-muted">· {next.headline}</span>}
          <span className="ml-auto text-muted">starts in <Countdown to={next.startsAt} onDone={() => router.refresh()} className="font-semibold text-ink" /></span>
        </p>
      )}
    </section>
  );
}

/** Product page strip: which sale, how long it lasts, how many are left at this price. */
export function PromoStrip({ promo }: { promo: PromoBadge }) {
  const router = useRouter();
  return (
    <Link href={`/sale/${promo.slug}`} className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm bg-ink px-4 py-3 text-sm text-paper hover:bg-ink/90">
      <span className="rounded-sm bg-rose px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-ink">{kind(promo.type)} -{promo.percentOff}%</span>
      <span className="font-semibold">{promo.name}</span>
      <span className="text-paper/75">ends in <Countdown to={promo.endsAt} onDone={() => router.refresh()} className="font-semibold text-paper" /></span>
      {promo.stockLeft != null && <span className="ml-auto text-rose">{promo.stockLeft <= 0 ? 'Sold out at this price' : `Only ${promo.stockLeft} left at this price`}</span>}
    </Link>
  );
}
