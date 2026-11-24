import type { Metadata, Viewport } from 'next';
import { Inter, Manrope } from 'next/font/google';
import { Providers } from './providers';
import { SiteFooter, SiteHeader } from '@/components/site-chrome';
import { CartDrawer, QuickView } from '@/components/shop-overlays';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', weight: ['500', '700', '800'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'VÉLORA — Define Your Style', template: '%s · VÉLORA' },
  description: 'Where Elegance Meets Expression. Fashion, beauty and lifestyle, delivered across Ghana.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
};

export const viewport: Viewport = { themeColor: '#111111', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GH" className={`${inter.variable} ${manrope.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
          Skip to content
        </a>
        <Providers>
          <SiteHeader />
          <main id="main" className="flex-1">{children}</main>
          <SiteFooter />
          <CartDrawer />
          <QuickView />
        </Providers>
      </body>
    </html>
  );
}
