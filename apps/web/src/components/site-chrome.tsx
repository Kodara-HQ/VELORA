'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useCart, useUi, useWishlist } from '@/lib/shop';
import type { CategoryTreeNode } from '@/lib/types';
import { BagIcon, ChevronIcon, CloseIcon, HeartIcon, MenuIcon, UserIcon } from './icons';
import { SearchBox } from './search-box';
import { Container, cx, Logo } from './ui';
import { NewsletterForm } from './newsletter';

/** Admin and vendor portals render their own chrome. */
const isPortal = (p: string) => p === '/admin' || p === '/vendor' || p.startsWith('/admin/') || p.startsWith('/vendor/');

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api<CategoryTreeNode[]>('/categories', { auth: false }), staleTime: 600_000 });
}

function CountBadge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose px-1 text-[10px] font-bold text-ink">
      {n > 99 ? '99+' : n}
    </span>
  );
}

export function SiteHeader() {
  const { status, user } = useSession();
  const cart = useCart();
  const wishlist = useWishlist();
  const openCart = useUi((s) => s.openCart);
  const categories = useCategories();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => { setMenuOpen(false); setHovered(null); }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  if (isPortal(pathname)) return null;
  const iconBtn = 'relative flex h-10 w-10 items-center justify-center rounded-full hover:bg-sand';
  const tree = categories.data ?? [];
  const megaFor = tree.find((c) => c.slug === hovered);

  return (
    <header className="sticky top-0 z-40" onMouseLeave={() => setHovered(null)}>
      <div className="bg-ink text-paper">
        <Container className="flex h-9 items-center justify-center text-center text-[11px] font-medium uppercase tracking-[0.2em]">
          Free delivery in Greater Accra on orders over GH₵500 · Pay on delivery
        </Container>
      </div>
      <div className="border-b border-line bg-ivory/95 backdrop-blur">
        <Container className="flex h-16 items-center gap-3 sm:h-[72px] sm:gap-6">
          <button type="button" className={cx(iconBtn, 'lg:hidden')} onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <MenuIcon />
          </button>
          <Link href="/" aria-label="VÉLORA home" className="text-[15px] sm:text-lg">
            <Logo />
          </Link>
          <Suspense fallback={<div className="hidden flex-1 md:block" />}>
            <SearchBox className="mx-auto hidden max-w-xl flex-1 md:block" />
          </Suspense>
          <nav aria-label="Shopping" className="ml-auto flex items-center gap-0.5 md:ml-0">
            <Link href={status === 'authenticated' ? '/account' : '/login'} className={iconBtn}
              aria-label={status === 'authenticated' ? `Account for ${user?.firstName}` : 'Sign in'}>
              <UserIcon />
            </Link>
            <Link href="/account/wishlist" className={iconBtn} aria-label={`Wishlist, ${wishlist.count} items`}>
              <HeartIcon /><CountBadge n={wishlist.count} />
            </Link>
            <button type="button" onClick={() => openCart()} className={iconBtn} aria-label={`Bag, ${cart.data?.itemCount ?? 0} items`}>
              <BagIcon /><CountBadge n={cart.data?.itemCount ?? 0} />
            </button>
          </nav>
        </Container>
        <Container className="pb-3 md:hidden">
          <Suspense><SearchBox /></Suspense>
        </Container>
        <nav aria-label="Departments" className="hidden border-t border-line lg:block">
          <Container className="flex h-11 items-center justify-center gap-7 text-[13px] font-medium">
            <Link href="/shop?sort=newest" className="hover:text-rose-deep">New In</Link>
            {tree.map((c) => (
              <Link key={c.slug} href={`/c/${c.slug}`} onMouseEnter={() => setHovered(c.slug)} onFocus={() => setHovered(c.slug)}
                className={cx('border-b-2 py-2.5 hover:text-rose-deep', pathname === `/c/${c.slug}` ? 'border-ink' : 'border-transparent')}>
                {c.name.replace(/'s Fashion$/, "'s").replace(' & Lifestyle', '')}
              </Link>
            ))}
            <Link href="/shop?onSale=true" className="font-semibold text-rose-deep">Sale</Link>
          </Container>
        </nav>
      </div>

      {megaFor && megaFor.children.length > 0 && (
        <div className="absolute inset-x-0 hidden border-b border-line bg-paper shadow-lg lg:block animate-fade-up" onMouseEnter={() => setHovered(megaFor.slug)}>
          <Container className="grid grid-cols-[1fr_2fr] gap-10 py-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-rose-deep">Shop</p>
              <p className="mt-2 font-display text-3xl font-extrabold">{megaFor.name}</p>
              <Link href={`/c/${megaFor.slug}`} className="mt-4 inline-block text-sm font-semibold underline underline-offset-4">Shop all {megaFor.name}</Link>
            </div>
            <ul className="grid grid-cols-3 content-start gap-x-8 gap-y-3 text-sm">
              {megaFor.children.map((ch) => (
                <li key={ch.slug}><Link href={`/c/${ch.slug}`} className="hover:text-rose-deep hover:underline underline-offset-4">{ch.name}</Link></li>
              ))}
            </ul>
          </Container>
        </div>
      )}

      {menuOpen && <MobileMenu tree={tree} onClose={() => setMenuOpen(false)} />}
    </header>
  );
}

function MobileMenu({ tree, onClose }: { tree: CategoryTreeNode[]; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const { status } = useSession();
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <button type="button" className="absolute inset-0 bg-ink/40" onClick={onClose} aria-label="Close menu" />
      <div className="absolute inset-y-0 left-0 flex w-[86vw] max-w-sm flex-col bg-ivory shadow-2xl animate-fade-up">
        <div className="flex h-16 items-center justify-between border-b border-line px-4">
          <Logo className="text-[15px]" />
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-sand" aria-label="Close menu"><CloseIcon /></button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <Link href="/shop?sort=newest" className="block rounded-sm px-3 py-3 font-semibold">New In</Link>
          {tree.map((c) => (
            <div key={c.slug} className="border-b border-line/60">
              <button type="button" onClick={() => setOpen(open === c.slug ? null : c.slug)} aria-expanded={open === c.slug}
                className="flex w-full items-center justify-between px-3 py-3 text-left font-medium">
                {c.name}<ChevronIcon dir={open === c.slug ? 'up' : 'down'} width={16} height={16} />
              </button>
              {open === c.slug && (
                <ul className="pb-3 pl-6 text-sm">
                  <li><Link href={`/c/${c.slug}`} className="block py-2 font-semibold">Shop all</Link></li>
                  {c.children.map((ch) => <li key={ch.slug}><Link href={`/c/${ch.slug}`} className="block py-2 text-muted">{ch.name}</Link></li>)}
                </ul>
              )}
            </div>
          ))}
          <Link href="/shop?onSale=true" className="block px-3 py-3 font-semibold text-rose-deep">Sale</Link>
        </nav>
        <div className="grid grid-cols-2 gap-2 border-t border-line p-4 text-sm">
          <Link href={status === 'authenticated' ? '/account' : '/login'} className="rounded-sm border border-line px-3 py-2.5 text-center font-medium">
            {status === 'authenticated' ? 'My account' : 'Sign in'}
          </Link>
          <Link href="/track-order" className="rounded-sm border border-line px-3 py-2.5 text-center font-medium">Track order</Link>
        </div>
      </div>
    </div>
  );
}

export function SiteFooter() {
  const pathname = usePathname();
  const categories = useCategories();
  if (isPortal(pathname)) return null;
  return (
    <footer className="mt-20 bg-ink text-paper">
      <Container className="grid gap-10 py-14 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Logo tagline className="text-lg" />
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-paper/70">
            Where Elegance Meets Expression. Fashion, beauty and lifestyle from Ghanaian ateliers and international labels.
          </p>
          <div className="mt-6 max-w-sm"><NewsletterForm dark /></div>
        </div>
        <FooterCol title="Shop" links={[{ href: '/shop?sort=newest', label: 'New in' }, ...(categories.data ?? []).slice(0, 6).map((c) => ({ href: `/c/${c.slug}`, label: c.name })), { href: '/shop?onSale=true', label: 'Sale' }]} />
        <FooterCol title="Help" links={[
          { href: '/track-order', label: 'Track an order' },
          { href: '/account/orders', label: 'My orders' },
          { href: '/forgot-password', label: 'Reset password' },
        ]} />
        <FooterCol title="Account" links={[
          { href: '/login', label: 'Sign in' },
          { href: '/register', label: 'Become a member' },
          { href: '/account/wishlist', label: 'Wishlist' },
          { href: '/sell', label: 'Sell on VÉLORA' },
          { href: '/styleguide', label: 'Design system' },
        ]} />
      </Container>
      <div className="border-t border-paper/10">
        <Container className="flex flex-col gap-2 py-6 text-xs text-paper/60 sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} VÉLORA. All rights reserved.</span>
          <span>Prices in Ghana Cedi (GH₵) · Cash and MoMo on delivery</span>
        </Container>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <div>
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-paper/60">{title}</h2>
      <ul className="space-y-2.5 text-sm">
        {links.map((l) => <li key={l.href + l.label}><Link href={l.href} className="hover:text-rose">{l.label}</Link></li>)}
      </ul>
    </div>
  );
}
