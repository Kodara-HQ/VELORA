'use client';

import Link from 'next/link';
import { useSession } from '@/lib/session';
import { Container, Logo, Skeleton } from './ui';

export function SiteHeader() {
  const { status, user } = useSession();
  return (
    <header className="sticky top-0 z-40">
      <div className="bg-ink text-paper">
        <Container className="flex h-9 items-center justify-center text-center text-[11px] font-medium uppercase tracking-[0.2em]">
          Free delivery in Greater Accra on orders over GH₵500
        </Container>
      </div>
      <div className="border-b border-line bg-ivory/90 backdrop-blur">
        <Container className="flex h-16 items-center justify-between sm:h-20">
          <Link href="/" aria-label="VÉLORA home" className="text-[15px] sm:text-lg">
            <Logo />
          </Link>
          <nav aria-label="Account" className="flex items-center gap-1 text-sm">
            {status === 'loading' ? (
              <Skeleton className="h-5 w-24" />
            ) : status === 'authenticated' && user ? (
              <Link href="/account" className="flex items-center gap-2.5 rounded-sm px-2 py-2 hover:bg-sand">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose text-xs font-bold text-ink">
                  {user.firstName[0]}{user.lastName[0]}
                </span>
                <span className="hidden font-medium sm:inline">Hi, {user.firstName}</span>
              </Link>
            ) : (
              <>
                <Link href="/login" className="rounded-sm px-3 py-2 font-medium hover:bg-sand">Sign in</Link>
                <Link href="/register" className="rounded-sm bg-ink px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-paper hover:bg-ink-soft">
                  Join
                </Link>
              </>
            )}
          </nav>
        </Container>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 bg-ink text-paper">
      <Container className="grid gap-10 py-14 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo tagline className="text-lg" />
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-paper/70">
            Where Elegance Meets Expression. Fashion, beauty and lifestyle from Ghana and beyond.
          </p>
        </div>
        <div>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-paper/60">Account</h2>
          <ul className="space-y-2.5 text-sm">
            <li><Link href="/login" className="hover:text-rose">Sign in</Link></li>
            <li><Link href="/register" className="hover:text-rose">Create an account</Link></li>
            <li><Link href="/forgot-password" className="hover:text-rose">Reset your password</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-paper/60">Studio</h2>
          <ul className="space-y-2.5 text-sm">
            <li><Link href="/styleguide" className="hover:text-rose">Design system</Link></li>
          </ul>
        </div>
      </Container>
      <div className="border-t border-paper/10">
        <Container className="flex flex-col gap-2 py-6 text-xs text-paper/60 sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} VÉLORA. All rights reserved.</span>
          <span>Prices in Ghana Cedi (GH₵)</span>
        </Container>
      </div>
    </footer>
  );
}
