'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useCategories } from '@/components/site-chrome';
import { Alert, Button, ButtonLink, Container, Field, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { cx } from '@/lib/cx';
import { useSession } from '@/lib/session';
import { errorMessage } from '@/lib/shop';

interface MyApplication {
  application: { id: number; businessName: string; status: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED'; reviewNotes: string | null; createdAt: string } | null;
  vendor: { id: number; businessName: string; slug: string; status: string } | null;
}

const STEPS = [
  ['Apply', 'Tell us about your business. It takes five minutes.'],
  ['Get verified', 'We check your details within two working days.'],
  ['List your pieces', 'Add products in the vendor portal; we review each one.'],
  ['Get paid', 'Earnings are paid to your MoMo or bank after the 14-day return window.'],
];

export default function SellPage() {
  const { status } = useSession();
  const q = useQuery({ queryKey: ['my-vendor-application'], queryFn: () => api<MyApplication>('/me/vendor-application'), enabled: status === 'authenticated' });

  return (
    <>
      <section className="border-b border-line bg-rose">
        <Container className="grid gap-8 py-14 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em]">VÉLORA Marketplace</p>
            <h1 className="mt-4 font-display text-5xl font-extrabold leading-[0.95] sm:text-6xl">Sell to Ghana’s<br />best-dressed.</h1>
          </div>
          <p className="text-lg leading-relaxed">
            Reach shoppers across all 16 regions. We handle the storefront, payments, delivery and customer care; you focus on your craft.
          </p>
        </Container>
      </section>
      <Container className="py-12">
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="rounded-sm border border-line bg-paper p-5">
              <span className="font-display text-3xl font-extrabold text-rose-deep">{i + 1}</span>
              <p className="mt-2 font-semibold">{t}</p>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-sm text-muted">Commission is a simple percentage of each sale (typically 10–15%), agreed when you’re approved. No listing fees.</p>

        <div className="mt-12 max-w-2xl">
          {status === 'loading' || (status === 'authenticated' && q.isPending) ? <Skeleton className="h-64" />
            : status !== 'authenticated' ? (
              <div className="rounded-sm border border-line bg-paper p-6">
                <h2 className="text-xl font-extrabold">Start your application</h2>
                <p className="mt-2 text-sm text-muted">Sign in or create a free account first. Your shop is linked to it.</p>
                <div className="mt-5 flex gap-3"><ButtonLink href="/register">Create account</ButtonLink><ButtonLink href="/login?next=/sell" variant="secondary">Sign in</ButtonLink></div>
              </div>
            ) : q.isError ? <Alert tone="danger">{errorMessage(q.error)}</Alert>
            : q.data?.vendor ? (
              <Alert tone="success" title={`${q.data.vendor.businessName} is ${q.data.vendor.status === 'ACTIVE' ? 'live' : q.data.vendor.status.toLowerCase()}`}>
                {q.data.vendor.status === 'ACTIVE' ? <>Manage your products, orders and payouts in the <Link href="/vendor" className="font-semibold underline">vendor portal</Link>.</> : 'Contact vendors@velora.test about your shop.'}
              </Alert>
            ) : q.data?.application && q.data.application.status !== 'REJECTED' ? (
              <Alert tone="info" title={`Application for ${q.data.application.businessName}: ${q.data.application.status === 'SUBMITTED' ? 'received' : 'under review'}`}>
                Submitted {new Date(q.data.application.createdAt).toLocaleDateString('en-GB')}. We’ll notify you as soon as it’s decided.
              </Alert>
            ) : (
              <>
                {q.data?.application?.status === 'REJECTED' && (
                  <div className="mb-5"><Alert tone="warning" title="Your previous application wasn’t approved">{q.data.application.reviewNotes} You’re welcome to apply again.</Alert></div>
                )}
                <ApplicationForm />
              </>
            )}
        </div>
      </Container>
    </>
  );
}

function ApplicationForm() {
  const qc = useQueryClient();
  const cats = useCategories();
  const [v, setV] = useState({ businessName: '', registrationNumber: '', taxId: '', contactPhone: '', businessAddress: '', about: '' });
  const [categories, setCategories] = useState<string[]>([]);
  const submit = useMutation({
    mutationFn: () => api('/me/vendor-application', { method: 'POST', body: { ...v, productCategories: categories } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-vendor-application'] }),
  });
  const errs = submit.error instanceof ApiError ? submit.error.fieldErrors : {};
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const onSubmit = (e: FormEvent) => { e.preventDefault(); submit.mutate(); };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5 rounded-sm border border-line bg-paper p-6">
      <h2 className="text-xl font-extrabold">Apply to sell</h2>
      {submit.isError && !Object.keys(errs).length && <Alert tone="danger">{errorMessage(submit.error)}</Alert>}
      <Field label="Business name" value={v.businessName} onChange={set('businessName')} required error={errs.businessName} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Registration no. (optional)" value={v.registrationNumber} onChange={set('registrationNumber')} placeholder="CS123456789" error={errs.registrationNumber} />
        <Field label="TIN / Ghana Card (optional)" value={v.taxId} onChange={set('taxId')} placeholder="GHA-123456789-0" error={errs.taxId} />
      </div>
      <Field label="Business phone" type="tel" value={v.contactPhone} onChange={set('contactPhone')} placeholder="+233 24 123 4567" required error={errs.contactPhone} />
      <Field label="Business address" value={v.businessAddress} onChange={set('businessAddress')} placeholder="Shop 12, Makola Market, Accra" required error={errs.businessAddress} />
      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.1em]">What do you sell?</legend>
        <div className="flex flex-wrap gap-2">
          {(cats.data ?? []).map((c) => (
            <button key={c.slug} type="button" aria-pressed={categories.includes(c.slug)} onClick={() => setCategories(categories.includes(c.slug) ? categories.filter((x) => x !== c.slug) : [...categories, c.slug])}
              className={cx('rounded-full border px-3 py-1.5 text-sm', categories.includes(c.slug) ? 'border-ink bg-ink text-paper' : 'border-line hover:border-ink')}>{c.name}</button>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-[0.1em]">About your brand (optional)</span>
        <textarea value={v.about} onChange={set('about')} rows={3} className="mt-1.5 w-full rounded-sm border border-line p-3 text-sm" placeholder="Materials, where you make your pieces, what makes them special…" />
      </label>
      <Button type="submit" loading={submit.isPending} disabled={!categories.length}>Submit application</Button>
    </form>
  );
}
