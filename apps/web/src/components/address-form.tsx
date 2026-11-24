'use client';

import { GHANA_REGIONS } from '@velora/shared';
import { useId } from 'react';
import { Field } from './ui';
import { cx } from '@/lib/cx';

export interface AddressValues {
  label?: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  digitalAddress?: string;
  landmark?: string;
}

export const emptyAddress: AddressValues = { recipientName: '', phone: '', line1: '', line2: '', city: '', region: '', digitalAddress: '', landmark: '' };

export function validateAddress(a: AddressValues) {
  const e: Record<string, string> = {};
  if (a.recipientName.trim().length < 2) e.recipientName = 'Enter the recipient’s full name';
  if (!/^\+233[2-5]\d{8}$/.test(normalisePhone(a.phone))) e.phone = 'Enter a Ghana mobile number like +233241234567';
  if (a.line1.trim().length < 3) e.line1 = 'Enter a street address or house number';
  if (a.city.trim().length < 2) e.city = 'Enter a town or area';
  if (!a.region) e.region = 'Choose a region';
  if (a.digitalAddress && !/^[A-Z]{2}-\d{3,4}-\d{3,4}$/i.test(a.digitalAddress.trim())) e.digitalAddress = 'GhanaPost GPS looks like GA-183-8164';
  return e;
}

/** Accepts 024…, 24…, +233 24… and returns +23324…. */
export function normalisePhone(p: string) {
  const d = p.replace(/[\s-]/g, '');
  if (/^0[2-5]\d{8}$/.test(d)) return `+233${d.slice(1)}`;
  if (/^[2-5]\d{8}$/.test(d)) return `+233${d}`;
  if (/^233[2-5]\d{8}$/.test(d)) return `+${d}`;
  return d;
}

export function cleanAddress(a: AddressValues) {
  const out: AddressValues = { ...a, phone: normalisePhone(a.phone) };
  for (const k of ['line2', 'digitalAddress', 'landmark', 'label'] as const) if (!out[k]?.trim()) delete out[k];
  return out;
}

export function AddressFields({ value, onChange, errors }: { value: AddressValues; onChange: (v: AddressValues) => void; errors: Record<string, string> }) {
  const id = useId();
  const set = (k: keyof AddressValues) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label="Full name" value={value.recipientName} onChange={set('recipientName')} autoComplete="name" required error={errors.recipientName} />
      <Field label="Mobile number" type="tel" value={value.phone} onChange={set('phone')} autoComplete="tel" placeholder="024 123 4567" required
        hint="The rider will call this number" error={errors.phone} />
      <Field label="Street address / house no." value={value.line1} onChange={set('line1')} autoComplete="address-line1" required error={errors.line1} className="sm:col-span-2" />
      <Field label="Apartment, suite (optional)" value={value.line2 ?? ''} onChange={set('line2')} autoComplete="address-line2" className="sm:col-span-2" />
      <Field label="Town / area" value={value.city} onChange={set('city')} autoComplete="address-level2" placeholder="e.g. East Legon, Accra" required error={errors.city} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-region`} className="text-xs font-semibold uppercase tracking-[0.1em]">Region<span aria-hidden="true" className="text-rose-deep"> *</span></label>
        <select id={`${id}-region`} value={value.region} onChange={set('region')} autoComplete="address-level1" aria-invalid={!!errors.region || undefined}
          aria-describedby={errors.region ? `${id}-region-err` : undefined}
          className={cx('h-12 rounded-sm border bg-paper px-3 text-[15px]', errors.region ? 'border-danger' : 'border-line')}>
          <option value="">Select a region</option>
          {GHANA_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {errors.region && <p id={`${id}-region-err`} role="alert" className="text-[13px] text-danger">{errors.region}</p>}
      </div>
      <Field label="GhanaPost GPS (optional)" value={value.digitalAddress ?? ''} onChange={set('digitalAddress')} placeholder="GA-183-8164" error={errors.digitalAddress} />
      <Field label="Landmark (optional)" value={value.landmark ?? ''} onChange={set('landmark')} placeholder="Near the Total filling station" />
    </div>
  );
}

export function AddressText({ a }: { a: Partial<Record<keyof AddressValues, string | null>> }) {
  return (
    <address className="text-sm not-italic leading-relaxed">
      <span className="font-semibold">{a.recipientName}</span><br />
      {a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />
      {a.city}, {a.region}<br />
      {a.digitalAddress && <>{a.digitalAddress}<br /></>}
      {a.landmark && <span className="text-muted">{a.landmark}<br /></span>}
      {a.phone}
    </address>
  );
}
