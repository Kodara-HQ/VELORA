'use client';

import { Alert, Badge, Button, Card, Checkbox, Container, EmptyState, Field, Skeleton } from '@/components/ui';
import { discountPercent, formatMoney } from '@/lib/format';

const COLORS = [
  { name: 'Ink', hex: '#111111', use: 'Primary text, buttons', cls: 'bg-ink' },
  { name: 'Paper', hex: '#FFFFFF', use: 'Cards, inputs', cls: 'bg-paper' },
  { name: 'Ivory', hex: '#F8F7F4', use: 'Page background', cls: 'bg-ivory' },
  { name: 'Rose', hex: '#D9A0A7', use: 'Accent, behind ink text only', cls: 'bg-rose' },
  { name: 'Stone', hex: '#777777', use: 'Borders, icons, large type', cls: 'bg-stone' },
  { name: 'Muted', hex: '#5E5E5E', use: 'Secondary text (AA)', cls: 'bg-muted' },
];

/** Example product card. Example data only, used to show the component. Real cards read from the catalogue API. */
function ProductCardExample({ name, brand, price, compareAt }: { name: string; brand: string; price: string; compareAt?: string }) {
  const off = discountPercent(price, compareAt);
  return (
    <article className="group">
      <div className="relative aspect-[3/4] overflow-hidden rounded-sm bg-sand">
        {off && <Badge tone="rose" className="absolute left-2 top-2">-{off}%</Badge>}
        <div className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted">{brand}</p>
      <h3 className="mt-1 text-sm font-medium">{name}</h3>
      <p className="mt-1 text-sm">
        <span className="font-semibold">{formatMoney(price)}</span>
        {off && <s className="ml-2 text-muted">{formatMoney(compareAt!)}</s>}
      </p>
    </article>
  );
}

export default function StyleguidePage() {
  return (
    <Container className="py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-deep">Design system</p>
      <h1 className="mt-2 text-4xl font-extrabold">VÉLORA components</h1>

      <section className="mt-12">
        <h2 className="text-xl font-bold">Colour</h2>
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {COLORS.map((c) => (
            <div key={c.name}>
              <div className={`h-20 rounded-sm border border-line ${c.cls}`} />
              <p className="mt-2 text-sm font-semibold">{c.name} <span className="font-normal text-muted">{c.hex}</span></p>
              <p className="text-xs text-muted">{c.use}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-bold">Typography</h2>
        <p className="mt-5 text-display font-extrabold">DEFINE YOUR STYLE.</p>
        <p className="mt-4 font-display text-3xl font-bold">Manrope 700, heading</p>
        <p className="mt-2 max-w-prose text-[15px] leading-relaxed">Inter, body. Elegant, modern and readable at every size, from product descriptions to order receipts.</p>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-bold">Buttons</h2>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="accent">Accent</Button>
          <Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button loading>Loading</Button><Button disabled>Disabled</Button>
        </div>
      </section>

      <section className="mt-12 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-xl font-bold">Form fields</h2>
          <div className="mt-5 flex flex-col gap-5">
            <Field label="Email" placeholder="you@example.com" hint="We'll send your receipt here." />
            <Field label="Mobile number" defaultValue="0241" error="Enter a Ghana mobile number like +233241234567" />
            <Field label="Password" type="password" defaultValue="secret-pass" />
            <Checkbox label="Remember my delivery address" defaultChecked />
          </div>
        </Card>
        <Card className="p-6">
          <h2 className="text-xl font-bold">Feedback</h2>
          <div className="mt-5 flex flex-col gap-3">
            <Alert tone="success" title="Order confirmed">Payment verified by MTN Mobile Money.</Alert>
            <Alert tone="danger">That coupon has expired.</Alert>
            <Alert tone="warning">Only 2 left in size M.</Alert>
            <Alert>Delivery to Kumasi takes 2–3 days.</Alert>
            <div className="flex flex-wrap gap-2 pt-2">
              <Badge>Neutral</Badge><Badge tone="ink">New</Badge><Badge tone="rose">-20%</Badge>
              <Badge tone="success">In stock</Badge><Badge tone="danger">Sold out</Badge><Badge tone="outline">Made in Ghana</Badge>
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-bold">Product cards and loading states</h2>
        <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
          <ProductCardExample name="Satin Wrap Midi Dress" brand="VÉLORA Studio" price="389.00" compareAt="459.00" />
          <ProductCardExample name="Leather Court Sneakers" brand="Sahel Leather" price="420.00" />
          {[0, 1].map((i) => (
            <div key={i}><Skeleton className="aspect-[3/4]" /><Skeleton className="mt-3 h-3 w-16" /><Skeleton className="mt-2 h-4 w-3/4" /><Skeleton className="mt-2 h-4 w-20" /></div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <Card><EmptyState title="Your bag is empty" body="Items you add will wait here while you keep shopping." /></Card>
      </section>
    </Container>
  );
}
