'use client';

import { ButtonLink, Container } from '@/components/ui';
import { useSession } from '@/lib/session';

const CATEGORIES = ["Women's", "Men's", 'Children', 'Shoes', 'Bags', 'Jewellery', 'Accessories', 'Beauty', 'Home'];

export default function HomePage() {
  const status = useSession((s) => s.status);
  return (
    <>
      <section className="border-b border-line">
        <Container className="grid gap-10 py-14 sm:py-20 lg:grid-cols-[1.3fr_1fr] lg:items-end">
          <div className="animate-fade-up">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-rose-deep">Where Elegance Meets Expression</p>
            <h1 className="mt-5 text-display font-extrabold">DEFINE<br />YOUR STYLE.</h1>
          </div>
          <div className="animate-fade-up [animation-delay:120ms]">
            <p className="text-lg leading-relaxed text-muted">
              Fashion, beauty and lifestyle from Ghanaian ateliers and international labels, delivered to your door with Mobile Money or card.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {status === 'authenticated' ? (
                <ButtonLink href="/account" size="lg">Go to my account</ButtonLink>
              ) : (
                <>
                  <ButtonLink href="/register" size="lg">Become a member</ButtonLink>
                  <ButtonLink href="/login" size="lg" variant="secondary">Sign in</ButtonLink>
                </>
              )}
            </div>
          </div>
        </Container>
      </section>

      <section aria-labelledby="cats">
        <Container className="py-14">
          <h2 id="cats" className="text-xs font-semibold uppercase tracking-[0.25em] text-muted">The departments</h2>
          <ul className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-5 lg:grid-cols-9">
            {CATEGORIES.map((c, i) => (
              <li key={c} className={`flex aspect-[3/4] items-end p-3 text-sm font-semibold ${i % 3 === 1 ? 'bg-rose-soft' : 'bg-paper'}`}>
                {c}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">The full catalogue with search, filters and checkout opens with the storefront release.</p>
        </Container>
      </section>
    </>
  );
}
