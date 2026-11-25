'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Container, Skeleton } from '@/components/ui';
import { cx } from '@/lib/cx';
import { useCan, useSession } from '@/lib/session';

const NAV = [
  { href: '/account', label: 'Overview' },
  { href: '/account/orders', label: 'Orders' },
  { href: '/account/returns', label: 'Returns' },
  { href: '/account/wishlist', label: 'Wishlist' },
  { href: '/account/addresses', label: 'Addresses' },
  { href: '/account/loyalty', label: 'Rewards' },
  { href: '/account/reviews', label: 'Reviews' },
  { href: '/account/notifications', label: 'Notifications' },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { status, user } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const isStaff = useCan('dashboard.view');

  // UI redirect only — every /me endpoint is protected by the API itself.
  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  if (status !== 'authenticated' || !user) {
    return <Container className="py-12"><Skeleton className="h-10 w-64" /><Skeleton className="mt-8 h-72" /></Container>;
  }

  return (
    <Container className="py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-deep">My account</p>
      <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">Hello, {user.firstName}.</h1>
      <div className="mt-8 grid gap-8 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Account" className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
          {NAV.map((n) => {
            const active = n.href === '/account' ? pathname === n.href : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}
                className={cx('shrink-0 rounded-sm px-3 py-2.5 text-sm font-medium', active ? 'bg-ink text-paper' : 'hover:bg-sand')}>
                {n.label}
              </Link>
            );
          })}
          {isStaff && <Link href="/admin" className="shrink-0 rounded-sm px-3 py-2.5 text-sm font-semibold text-rose-deep hover:bg-sand">Admin dashboard →</Link>}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </Container>
  );
}
