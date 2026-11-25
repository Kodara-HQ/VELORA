'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AddressFields, AddressText, cleanAddress, emptyAddress, normalisePhone, validateAddress, type AddressValues } from '@/components/address-form';
import { Row } from '@/components/shop-overlays';
import { Alert, Button, ButtonLink, Checkbox, Container, EmptyState, Field, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { cx } from '@/lib/cx';
import { formatMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import { cartKey, errorMessage, useCart } from '@/lib/shop';
import type { Address, PaymentMethodOption, PlacedOrder, Quote, ShippingOption } from '@/lib/types';

const KEY_STORE = 'velora_checkout_key';

/** One key per checkout attempt; survives a refresh so a retried submit can never create a second order. */
function useIdempotencyKey() {
  const [key, setKey] = useState('');
  useEffect(() => {
    let k = '';
    try { k = sessionStorage.getItem(KEY_STORE) ?? ''; } catch { /* storage blocked */ }
    if (!k) {
      k = crypto.randomUUID();
      try { sessionStorage.setItem(KEY_STORE, k); } catch { /* storage blocked */ }
    }
    setKey(k);
  }, []);
  const reset = () => {
    try { sessionStorage.removeItem(KEY_STORE); } catch { /* storage blocked */ }
  };
  return { key, reset };
}

export default function CheckoutPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { status, user } = useSession();
  const cart = useCart();
  const idem = useIdempotencyKey();

  const [step, setStep] = useState(0);
  const [contact, setContact] = useState({ email: '', phone: '' });
  const [contactErr, setContactErr] = useState<Record<string, string>>({});
  const [addressId, setAddressId] = useState<number | 'new' | null>(null);
  const [address, setAddress] = useState<AddressValues>(emptyAddress);
  const [addressErr, setAddressErr] = useState<Record<string, string>>({});
  const [saveAddress, setSaveAddress] = useState(true);
  const [methodId, setMethodId] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [payMethod, setPayMethod] = useState('');
  // Loyalty: the shopper opts in; we apply the most points the order allows (capped server-side).
  const [usePoints, setUsePoints] = useState(false);
  const [maxPoints, setMaxPoints] = useState(0);
  const redeemPoints = usePoints && maxPoints > 0 ? maxPoints : undefined;
  const payMethods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api<PaymentMethodOption[]>('/checkout/payment-methods', { auth: false }), staleTime: 300_000 });
  useEffect(() => {
    if (payMethods.data?.length && !payMethods.data.some((m) => m.code === payMethod)) setPayMethod(payMethods.data[0].code);
  }, [payMethods.data, payMethod]);
  const chosen = payMethods.data?.find((m) => m.code === payMethod);

  const saved = useQuery({ queryKey: ['addresses', user?.id], queryFn: () => api<Address[]>('/me/addresses'), enabled: status === 'authenticated' });
  useEffect(() => {
    if (saved.data && addressId === null) setAddressId(saved.data.find((a) => a.isDefault)?.id ?? saved.data[0]?.id ?? 'new');
  }, [saved.data, addressId]);
  useEffect(() => {
    if (status === 'authenticated' && user && step === 0) {
      setContact({ email: user.email, phone: user.phone ?? '' });
      setStep(1);
    }
    if (status === 'anonymous' && addressId === null) setAddressId('new');
  }, [status, user, step, addressId]);

  const selectedSaved = typeof addressId === 'number' ? saved.data?.find((a) => a.id === addressId) : undefined;
  const region = selectedSaved?.region ?? (step >= 2 ? address.region : '');

  const options = useQuery({
    queryKey: ['shipping', region, cart.data?.estimatedTotal],
    queryFn: () => api<ShippingOption[]>(`/checkout/shipping-options?region=${encodeURIComponent(region)}`),
    enabled: !!region && step >= 2,
  });
  useEffect(() => {
    if (options.data?.length && !options.data.some((o) => o.id === methodId)) setMethodId(options.data[0].id);
  }, [options.data, methodId]);

  const quote = useQuery({
    queryKey: ['quote', region, methodId, cart.data?.estimatedTotal, contact.email, redeemPoints],
    queryFn: () => api<Quote>('/checkout/quote', { method: 'POST', body: { region, shippingMethodId: methodId ?? undefined, redeemPoints, ...(status !== 'authenticated' && contact.email && { email: contact.email }) } }),
    enabled: !!region && !!methodId && step >= 3,
    retry: false,
  });
  useEffect(() => { if (quote.data?.loyalty) setMaxPoints(quote.data.loyalty.maxPoints); }, [quote.data?.loyalty]);
  // If the allowance changed under us (bag edited, points spent elsewhere), start again without points.
  useEffect(() => {
    if (quote.error instanceof ApiError && quote.error.code === 'POINTS_UNAVAILABLE') { setUsePoints(false); setMaxPoints(0); }
  }, [quote.error]);

  const place = useMutation({
    mutationFn: () => api<PlacedOrder>('/checkout/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': idem.key },
      body: {
        ...(status !== 'authenticated' || contact.phone !== (user?.phone ?? '') ? { contact: { email: contact.email, phone: normalisePhone(contact.phone) } } : {}),
        ...(typeof addressId === 'number' ? { addressId } : { address: cleanAddress(address), ...(status === 'authenticated' && { saveAddress }) }),
        shippingMethodId: methodId,
        paymentMethod: payMethod,
        ...(note.trim() && { note: note.trim() }),
        expectedTotal: quote.data?.grandTotal,
        redeemPoints,
      },
    }),
    onSuccess: (order) => {
      idem.reset();
      try { sessionStorage.setItem('velora_last_order', JSON.stringify({ orderNumber: order.orderNumber, email: contact.email })); } catch { /* ignore */ }
      qc.setQueryData(['order', order.orderNumber], order);
      void qc.invalidateQueries({ queryKey: cartKey(user?.id ?? null) });
      // Online payment: hand over to the provider's hosted checkout (we never see card or MoMo PINs).
      if (order.nextAction) window.location.assign(order.nextAction.url);
      else router.replace(`/order/${order.orderNumber}${order.paymentError ? '?payError=1' : ''}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && ['PRICE_CHANGED', 'COUPON_INVALID', 'CART_ISSUES', 'INSUFFICIENT_STOCK', 'POINTS_UNAVAILABLE'].includes(e.code)) {
        void qc.invalidateQueries({ queryKey: ['quote'] });
        void cart.refetch();
      }
    },
  });

  const items = cart.data?.items ?? [];
  const totals = quote.data;
  const summary = useMemo(() => (
    <aside className="h-fit rounded-sm border border-line bg-paper p-6 lg:sticky lg:top-40">
      <h2 className="text-lg font-extrabold">In your bag ({cart.data?.itemCount ?? 0})</h2>
      <ul className="mt-4 max-h-72 space-y-4 overflow-y-auto pr-1">
        {items.map((l) => (
          <li key={l.id} className="flex gap-3 text-sm">
            <span className="relative h-20 w-15 shrink-0 overflow-hidden rounded-sm bg-sand" style={{ width: 60 }}>
              {l.image && <Image src={l.image} alt="" fill sizes="60px" className="object-cover" />}
              <span className="absolute right-0.5 top-0.5 rounded-full bg-ink px-1.5 text-[10px] font-bold text-paper">{l.quantity}</span>
            </span>
            <span className="min-w-0 flex-1"><span className="line-clamp-2">{l.name}</span><span className="text-xs text-muted">{l.variantLabel}</span></span>
            <span className="font-medium">{formatMoney(l.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5 space-y-2 border-t border-line pt-4">
        <Row label="Subtotal" value={formatMoney(totals?.subtotal ?? cart.data?.subtotal ?? '0')} />
        {(() => {
          const pts = totals?.loyalty?.points ? Number(totals.loyalty.value) : 0;
          const coupon = Number(totals?.discountTotal ?? cart.data?.discountTotal ?? 0) - pts;
          return (
            <>
              {coupon > 0.004 && <Row label={`Discount${cart.data?.coupon ? ` (${cart.data.coupon.code})` : ''}`} value={`−${formatMoney(coupon.toFixed(2))}`} accent />}
              {pts > 0 && <Row label={`Points (${totals!.loyalty!.points.toLocaleString()})`} value={`−${formatMoney(totals!.loyalty!.value)}`} accent />}
            </>
          );
        })()}
        <Row label="Delivery" value={totals ? (Number(totals.shippingTotal) === 0 ? 'Free' : formatMoney(totals.shippingTotal)) : '—'} />
        {totals && Number(totals.taxTotal) > 0 && <Row label="Tax" value={formatMoney(totals.taxTotal)} />}
        <div className="border-t border-line pt-3"><Row label="Total" value={totals ? formatMoney(totals.grandTotal) : formatMoney(cart.data?.estimatedTotal ?? '0')} strong /></div>
        {totals && Number(totals.taxIncluded) > 0 && <p className="text-xs text-muted">Includes {formatMoney(totals.taxIncluded)} tax</p>}
      </div>
    </aside>
  ), [items, totals, cart.data]);

  if (status === 'loading' || cart.isPending) {
    return <Container className="py-10"><Skeleton className="h-10 w-48" /><div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]"><Skeleton className="h-96" /><Skeleton className="h-72" /></div></Container>;
  }
  if (!items.length && !place.isSuccess) {
    return <Container className="py-10"><EmptyState title="Your bag is empty" body="Add something you love, then check out here." action={<ButtonLink href="/shop">Continue shopping</ButtonLink>} /></Container>;
  }

  const continueContact = () => {
    const e: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(contact.email.trim())) e.email = 'Enter a valid email address';
    if (!/^\+233[2-5]\d{8}$/.test(normalisePhone(contact.phone))) e.phone = 'Enter a Ghana mobile number like 024 123 4567';
    setContactErr(e);
    if (!Object.keys(e).length) setStep(1);
  };
  const continueAddress = () => {
    if (typeof addressId === 'number') return setStep(2);
    const e = validateAddress(address);
    setAddressErr(e);
    if (!Object.keys(e).length) setStep(2);
  };
  const shippingName = options.data?.find((o) => o.id === methodId);

  return (
    <Container className="py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold sm:text-4xl">Checkout</h1>
        <Link href="/cart" className="text-sm font-semibold underline underline-offset-4">Back to bag</Link>
      </div>
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {cart.data?.hasIssues && <Alert tone="warning" title="Your bag needs attention">Some items are no longer available in the quantity you chose. <Link href="/cart" className="underline">Review your bag</Link>.</Alert>}

          <Step n={1} title="Contact" active={step === 0} done={step > 0} onEdit={status !== 'authenticated' ? () => setStep(0) : undefined}
            summary={<p className="text-sm">{contact.email}{contact.phone && ` · ${contact.phone}`}</p>}>
            {status !== 'authenticated' && (
              <p className="mb-5 text-sm text-muted">Have an account? <Link href="/login?next=/checkout" className="font-semibold text-ink underline">Sign in</Link> for faster checkout and to earn points.</p>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Email" type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" required
                hint="For your receipt and delivery updates" error={contactErr.email} />
              <Field label="Mobile number" type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} autoComplete="tel" placeholder="024 123 4567" required error={contactErr.phone} />
            </div>
            <Button className="mt-6" onClick={continueContact}>Continue to delivery</Button>
          </Step>

          <Step n={2} title="Delivery address" active={step === 1} done={step > 1} onEdit={() => setStep(1)}
            summary={<AddressText a={selectedSaved ?? address} />}>
            {status === 'authenticated' && !!saved.data?.length && (
              <fieldset className="mb-5 space-y-3">
                <legend className="sr-only">Choose an address</legend>
                {saved.data.map((a) => (
                  <label key={a.id} className={cx('flex cursor-pointer gap-3 rounded-sm border p-4', addressId === a.id ? 'border-ink bg-paper' : 'border-line')}>
                    <input type="radio" name="addr" className="mt-1 accent-ink" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                    <span className="flex-1"><AddressText a={{ ...a, line2: a.line2 ?? undefined, digitalAddress: a.digitalAddress ?? undefined, landmark: a.landmark ?? undefined }} /></span>
                    {a.label && <span className="text-xs font-semibold uppercase tracking-wider text-muted">{a.label}</span>}
                  </label>
                ))}
                <label className={cx('flex cursor-pointer gap-3 rounded-sm border p-4', addressId === 'new' ? 'border-ink bg-paper' : 'border-line')}>
                  <input type="radio" name="addr" className="accent-ink" checked={addressId === 'new'} onChange={() => setAddressId('new')} />
                  <span className="text-sm font-semibold">Deliver to a new address</span>
                </label>
              </fieldset>
            )}
            {addressId === 'new' && (
              <>
                <AddressFields value={address} onChange={setAddress} errors={addressErr} />
                {status === 'authenticated' && <div className="mt-4"><Checkbox label="Save this address to my account" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} /></div>}
              </>
            )}
            <Button className="mt-6" onClick={continueAddress}>Continue to delivery method</Button>
          </Step>

          <Step n={3} title="Delivery method" active={step === 2} done={step > 2} onEdit={() => setStep(2)}
            summary={shippingName && <p className="text-sm">{shippingName.name} · {Number(shippingName.fee) === 0 ? 'Free' : formatMoney(shippingName.fee)}</p>}>
            {options.isPending ? <Skeleton className="h-24" /> : options.isError ? <Alert tone="danger">{errorMessage(options.error)}</Alert> : !options.data?.length ? (
              <Alert tone="warning">We don’t deliver to {region} yet. Please choose another address.</Alert>
            ) : (
              <fieldset className="space-y-3">
                <legend className="sr-only">Delivery options</legend>
                {options.data.map((o) => (
                  <label key={o.id} className={cx('flex cursor-pointer items-center gap-3 rounded-sm border p-4 text-sm', methodId === o.id ? 'border-ink bg-paper' : 'border-line')}>
                    <input type="radio" name="ship" className="accent-ink" checked={methodId === o.id} onChange={() => setMethodId(o.id)} />
                    <span className="flex-1">
                      <span className="font-semibold">{o.name}</span>
                      <span className="block text-muted">
                        {o.maxDays === 0 ? 'Today' : o.minDays === o.maxDays ? `${o.maxDays} day${o.maxDays === 1 ? '' : 's'}` : `${o.minDays}–${o.maxDays} working days`}
                        {o.freeOver && Number(o.fee) > 0 && ` · free over ${formatMoney(o.freeOver)}`}
                      </span>
                    </span>
                    <span className="font-semibold">{Number(o.fee) === 0 ? (Number(o.baseFee) > 0 ? <><s className="mr-1 font-normal text-muted">{formatMoney(o.baseFee)}</s>Free</> : 'Free') : formatMoney(o.fee)}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <Button className="mt-6" onClick={() => methodId && setStep(3)} disabled={!methodId}>Continue to payment</Button>
          </Step>

          <Step n={4} title="Payment & review" active={step === 3} done={false}>
            {status === 'authenticated' && quote.data?.loyalty && quote.data.loyalty.balance > 0 && (
              <div className="mb-6 rounded-sm border border-line bg-ivory p-4 text-sm">
                <p className="font-semibold">VÉLORA Rewards · {quote.data.loyalty.balance.toLocaleString()} points</p>
                {maxPoints > 0 ? (
                  <label className="mt-2 flex cursor-pointer items-start gap-3">
                    <input type="checkbox" className="mt-1 accent-ink" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} disabled={quote.isFetching} />
                    <span>
                      Use {maxPoints.toLocaleString()} points{usePoints && quote.data.loyalty.points ? <> to save <b>{formatMoney(quote.data.loyalty.value)}</b></> : ''}
                      <span className="block text-xs text-muted">Points can pay for up to half of your items. You’ll still earn points on what you pay.</span>
                    </span>
                  </label>
                ) : <p className="mt-1 text-xs text-muted">Not enough points to use on this order yet. <Link href="/account/loyalty" className="underline">How rewards work</Link></p>}
              </div>
            )}
            <fieldset>
              <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.12em]">Payment method</legend>
              {payMethods.isPending ? <Skeleton className="h-20" /> : payMethods.isError ? <Alert tone="danger">{errorMessage(payMethods.error)}</Alert> : (
                <div className="space-y-3">
                  {payMethods.data?.map((m) => (
                    <label key={m.code} className={cx('flex cursor-pointer items-start gap-3 rounded-sm border p-4 text-sm', payMethod === m.code ? 'border-ink bg-paper' : 'border-line')}>
                      <input type="radio" name="pay" className="mt-1 accent-ink" checked={payMethod === m.code} onChange={() => setPayMethod(m.code)} />
                      <span className="flex-1">
                        <span className="font-semibold">{m.label}</span>
                        {m.code === 'SIMULATOR' && <span className="ml-2 rounded-sm bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning">Dev only</span>}
                        <span className="block text-muted">{m.detail}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {chosen?.online && (
                <p className="mt-2 text-xs text-muted">
                  You’ll be taken to a secure payment page to confirm. Your items are held for you while you pay.
                </p>
              )}
            </fieldset>
            <label className="mt-6 block text-xs font-semibold uppercase tracking-[0.12em]" htmlFor="note">Delivery note (optional)</label>
            <textarea id="note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} placeholder="e.g. Call when you reach the gate"
              className="mt-2 w-full rounded-sm border border-line bg-paper p-3 text-sm focus:border-ink focus:outline-none" />
            {quote.data?.coupon && !quote.data.coupon.valid && <div className="mt-4"><Alert tone="warning">Code {quote.data.coupon.code}: {quote.data.coupon.reason}</Alert></div>}
            {place.isError && (
              <div className="mt-4">
                <Alert tone="danger" title="We couldn’t place your order">
                  {errorMessage(place.error)}
                  {place.error instanceof ApiError && ['CART_ISSUES', 'INSUFFICIENT_STOCK'].includes(place.error.code) && <> <Link href="/cart" className="underline">Review your bag</Link></>}
                </Alert>
              </div>
            )}
            <Button size="lg" block className="mt-6" onClick={() => place.mutate()} loading={place.isPending}
              disabled={!quote.data || !payMethod || quote.isFetching || !idem.key || cart.data?.hasIssues || (quote.data.coupon ? !quote.data.coupon.valid : false)}>
              {quote.data ? `${chosen?.online ? 'Pay' : 'Place order'} · ${formatMoney(quote.data.grandTotal)}` : 'Calculating total…'}
            </Button>
            <p className="mt-3 text-center text-xs text-muted">By placing your order you agree to VÉLORA’s terms of sale and 14-day returns policy.</p>
          </Step>
        </div>
        {summary}
      </div>
    </Container>
  );
}

function Step({ n, title, active, done, onEdit, summary, children }: {
  n: number; title: string; active: boolean; done: boolean; onEdit?: () => void; summary?: ReactNode; children: ReactNode;
}) {
  return (
    <section aria-labelledby={`step-${n}`} className={cx('rounded-sm border bg-paper', active ? 'border-ink' : 'border-line')}>
      <header className="flex items-center gap-3 px-5 py-4 sm:px-6">
        <span className={cx('flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold', done ? 'bg-ink text-paper' : active ? 'bg-rose text-ink' : 'bg-sand text-muted')}>{done ? '✓' : n}</span>
        <h2 id={`step-${n}`} className={cx('flex-1 font-display text-lg font-bold', !active && !done && 'text-muted')}>{title}</h2>
        {done && onEdit && <button type="button" onClick={onEdit} className="text-sm font-semibold underline underline-offset-4">Edit</button>}
      </header>
      {active && <div className="border-t border-line px-5 py-6 sm:px-6 animate-fade-up">{children}</div>}
      {done && !active && summary && <div className="border-t border-line px-5 py-4 sm:px-6">{summary}</div>}
    </section>
  );
}
