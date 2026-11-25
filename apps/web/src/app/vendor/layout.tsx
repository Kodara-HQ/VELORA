'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { PERMISSIONS, type Permission } from '@velora/shared';
import { CloseIcon, MenuIcon } from '@/components/icons';
import { NotificationBell } from '@/components/notification-bell';
import { Logo, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { useSession } from '@/lib/session';

const P = PERMISSIONS;
const NAV: Array<{ href: string; label: string; perm: Permission }> = [
  { href: '/vendor', label: 'Dashboard', perm: P.VENDOR_PORTAL_ACCESS },
  { href: '/vendor/products', label: 'Products', perm: P.VENDOR_PORTAL_ACCESS },
  { href: '/vendor/inventory', label: 'Inventory', perm: P.VENDOR_PORTAL_ACCESS },
  { href: '/vendor/orders', label: 'Orders', perm: P.VENDOR_ORDERS_VIEW },
  { href: '/vendor/payouts', label: 'Earnings & payouts', perm: P.VENDOR_REPORTS_VIEW },
  { href: '/vendor/reports', label: 'Sales report', perm: P.VENDOR_REPORTS_VIEW },
  { href: '/vendor/reviews', label: 'Reviews', perm: P.VENDOR_PORTAL_ACCESS },
  { href: '/vendor/notifications', label: 'Notifications', perm: P.VENDOR_PORTAL_ACCESS },
  { href: '/vendor/profile', label: 'Shop profile', perm: P.VENDOR_PORTAL_ACCESS },
];

export default function VendorLayout({ children }: { children: ReactNode }) {
  const { status, user, signOutLocal } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);
  useEffect(() => setNavOpen(false), [pathname]);

  if (status !== 'authenticated' || !user) {
    return <div className="flex min-h-dvh"><Skeleton className="hidden w-60 lg:block" /><div className="flex-1 p-8"><Skeleton className="h-10 w-64" /><Skeleton className="mt-6 h-64" /></div></div>;
  }
  if (!user.permissions.includes(P.VENDOR_PORTAL_ACCESS) || !user.vendorId) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-2xl font-extrabold">Vendor portal</h1>
        <p className="mt-2 text-sm text-muted">This area is for approved VÉLORA Marketplace sellers. Apply to open your shop; once you’re approved, the portal appears here.</p>
        <div className="mt-6 flex justify-center gap-4 text-sm font-semibold">
          <Link href="/sell" className="underline">Apply to sell</Link>
          <Link href="/" className="underline">Back to the store</Link>
        </div>
      </div>
    );
  }

  const items = NAV.filter((i) => user.permissions.includes(i.perm));
  const active = (href: string) => (href === '/vendor' ? pathname === href : pathname.startsWith(href));
  const sidebar = (
    <div className="flex h-full flex-col bg-ink text-paper">
      <div className="flex h-16 items-center justify-between px-6">
        <Link href="/vendor" className="text-[15px]"><Logo /></Link>
        <span className="rounded-sm bg-rose px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink">Seller</span>
      </div>
      <nav aria-label="Vendor portal" className="flex-1 overflow-y-auto px-3 py-5">
        <ul className="space-y-0.5">
          {items.map((i) => (
            <li key={i.href}>
              <Link href={i.href} aria-current={active(i.href) ? 'page' : undefined}
                className={cx('block rounded-sm px-3 py-2 text-sm', active(i.href) ? 'bg-paper/12 font-semibold text-paper' : 'text-paper/75 hover:bg-paper/8 hover:text-paper')}>
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-paper/10 p-4 text-xs text-paper/60">
        <p className="truncate font-semibold text-paper">{user.firstName} {user.lastName}</p>
        <p className="truncate">{user.email}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-ivory lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>
      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Vendor menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink/50" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">{sidebar}</div>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-ivory/95 px-4 backdrop-blur sm:px-6">
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-sand lg:hidden" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            {navOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell allHref="/vendor/notifications" />
            <Link href="/" className="hidden rounded-sm px-3 py-2 text-sm font-medium hover:bg-sand sm:block">View store</Link>
            <button type="button" className="rounded-sm px-3 py-2 text-sm font-medium hover:bg-sand"
              onClick={async () => { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => undefined); signOutLocal(); router.replace('/login'); }}>
              Sign out
            </button>
          </div>
        </header>
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </div>
    </div>
  );
}
