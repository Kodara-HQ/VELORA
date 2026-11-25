'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PERMISSIONS, STAFF_ROLES, type Permission } from '@velora/shared';
import { CloseIcon, MenuIcon } from '@/components/icons';
import { Logo, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { cx } from '@/lib/cx';
import { useSession } from '@/lib/session';

const P = PERMISSIONS;
const ADMIN_NAV: Array<{ section: string; items: Array<{ href: string; label: string; perm: Permission }> }> = [
  { section: 'Overview', items: [
    { href: '/admin', label: 'Dashboard', perm: P.DASHBOARD_VIEW },
    { href: '/admin/reports', label: 'Reports', perm: P.ANALYTICS_VIEW },
  ] },
  { section: 'Sales', items: [
    { href: '/admin/orders', label: 'Orders', perm: P.ORDERS_VIEW },
    { href: '/admin/customers', label: 'Customers', perm: P.CUSTOMERS_VIEW },
    { href: '/admin/returns', label: 'Returns', perm: P.RETURNS_VIEW },
  ] },
  { section: 'Finance', items: [
    { href: '/admin/refunds', label: 'Refunds', perm: P.REFUNDS_PROCESS },
    { href: '/admin/payments', label: 'Payments', perm: P.PAYMENTS_VIEW },
  ] },
  { section: 'Marketplace', items: [
    { href: '/admin/vendors', label: 'Vendors', perm: P.VENDORS_VIEW },
    { href: '/admin/vendor-applications', label: 'Applications', perm: P.VENDORS_VIEW },
    { href: '/admin/settlements', label: 'Settlements', perm: P.SETTLEMENTS_MANAGE },
  ] },
  { section: 'Catalogue', items: [
    { href: '/admin/products', label: 'Products', perm: P.PRODUCTS_VIEW },
    { href: '/admin/categories', label: 'Categories & brands', perm: P.PRODUCTS_VIEW },
  ] },
  { section: 'Inventory', items: [
    { href: '/admin/inventory', label: 'Stock levels', perm: P.INVENTORY_VIEW },
    { href: '/admin/inventory/movements', label: 'Stock movements', perm: P.INVENTORY_VIEW },
    { href: '/admin/inventory/transfers', label: 'Transfers', perm: P.INVENTORY_VIEW },
    { href: '/admin/inventory/purchase-orders', label: 'Purchase orders', perm: P.INVENTORY_VIEW },
    { href: '/admin/inventory/suppliers', label: 'Suppliers', perm: P.INVENTORY_VIEW },
    { href: '/admin/inventory/warehouses', label: 'Warehouses', perm: P.INVENTORY_VIEW },
  ] },
  { section: 'Administration', items: [
    { href: '/admin/users', label: 'Staff & roles', perm: P.USERS_VIEW },
    { href: '/admin/audit', label: 'Audit log', perm: P.AUDIT_VIEW },
  ] },
];

interface Counts { ordersToFulfil: number; lowStockVariants: number; vendorApplications: number; productsToReview: number }

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { status, user, signOutLocal } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const isStaff = !!user?.roles.some((r) => (STAFF_ROLES as string[]).includes(r));
  const can = (p: Permission) => !!user?.permissions.includes(p);

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);
  useEffect(() => setNavOpen(false), [pathname]);

  // Staff without the dashboard land on the first area they can use.
  useEffect(() => {
    if (pathname === '/admin' && user && isStaff && !can(P.DASHBOARD_VIEW)) {
      const first = ADMIN_NAV.flatMap((s) => s.items).find((i) => can(i.perm));
      if (first) router.replace(first.href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, user, isStaff]);

  if (status !== 'authenticated' || !user) {
    return <div className="flex min-h-dvh"><Skeleton className="hidden w-60 lg:block" /><div className="flex-1 p-8"><Skeleton className="h-10 w-64" /><Skeleton className="mt-6 h-64" /></div></div>;
  }
  if (!isStaff) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-2xl font-extrabold">Staff only</h1>
        <p className="mt-2 text-sm text-muted">This area is for VÉLORA staff. If you work here, sign in with your staff account.</p>
        <Link href="/" className="mt-6 inline-block text-sm font-semibold underline">Back to the store</Link>
      </div>
    );
  }

  const sections = ADMIN_NAV.map((s) => ({ ...s, items: s.items.filter((i) => can(i.perm)) })).filter((s) => s.items.length);
  const active = (href: string) => (href === '/admin' ? pathname === '/admin' : href === '/admin/inventory' ? pathname === href : pathname.startsWith(href));

  const nav = (
    <nav aria-label="Admin" className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
      {sections.map((s) => (
        <div key={s.section}>
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-paper/45">{s.section}</p>
          <ul className="space-y-0.5">
            {s.items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} aria-current={active(i.href) ? 'page' : undefined}
                  className={cx('block rounded-sm px-3 py-2 text-sm', active(i.href) ? 'bg-paper/12 font-semibold text-paper' : 'text-paper/75 hover:bg-paper/8 hover:text-paper')}>
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-ink text-paper">
      <div className="flex h-16 items-center justify-between px-6">
        <Link href="/admin" className="text-[15px]"><Logo /></Link>
        <span className="rounded-sm bg-rose px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink">Admin</span>
      </div>
      {nav}
      <div className="border-t border-paper/10 p-4 text-xs text-paper/60">
        <p className="truncate font-semibold text-paper">{user.firstName} {user.lastName}</p>
        <p className="truncate">{user.roles.map((r) => r.replace(/_/g, ' ')).join(', ')}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-ivory lg:grid lg:grid-cols-[240px_1fr] print:block print:bg-paper">
      <aside className="sticky top-0 hidden h-dvh lg:block print:hidden">{sidebar}</aside>
      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink/50" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-64">{sidebar}</div>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex print:hidden h-16 items-center gap-3 border-b border-line bg-ivory/95 px-4 backdrop-blur sm:px-6">
          <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-sand lg:hidden" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            {navOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
          <div className="ml-auto flex items-center gap-2">
            {(can(P.DASHBOARD_VIEW) || can(P.ORDERS_VIEW)) && <Notifications enabled={can(P.DASHBOARD_VIEW)} />}
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

function Notifications({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['admin-notifications'], queryFn: () => api<Counts>('/admin/notifications'), enabled, refetchInterval: 60_000 });
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!enabled) return null;
  const c = q.data;
  const items = c ? [
    { n: c.ordersToFulfil, label: 'orders to fulfil', href: '/admin/orders?view=open' },
    { n: c.lowStockVariants, label: 'variants low or out of stock', href: '/admin/inventory?stock=low' },
    { n: c.productsToReview, label: 'vendor products awaiting review', href: '/admin/products?status=PENDING_REVIEW' },
    { n: c.vendorApplications, label: 'vendor applications', href: '/admin/vendor-applications?status=SUBMITTED' },
  ].filter((i) => i.n > 0) : [];
  const total = items.reduce((s, i) => s + i.n, 0);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Notifications, ${total} need attention`}
        className="relative flex h-10 w-10 items-center justify-center rounded-full hover:bg-sand">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {total > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-rose-deep ring-2 ring-ivory" />}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-80 rounded-md border border-line bg-paper shadow-xl animate-fade-up">
          <p className="border-b border-line px-4 py-3 text-sm font-bold">Needs attention</p>
          {!items.length ? <p className="px-4 py-6 text-center text-sm text-muted">All caught up.</p> : (
            <ul className="py-1">
              {items.map((i) => (
                <li key={i.label}>
                  <Link href={i.href} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-sand">
                    <span className="min-w-8 rounded-sm bg-ink px-1.5 py-0.5 text-center text-xs font-bold text-paper">{i.n}</span>{i.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
