'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Button, Checkbox, Field } from '@/components/ui';
import { api, ApiError, type SessionPayload } from '@/lib/api';
import { useSession } from '@/lib/session';

const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;

export default function RegisterPage() {
  return <Suspense><RegisterForm /></Suspense>;
}

function RegisterForm() {
  const router = useRouter();
  const ref = useSearchParams().get('ref')?.toUpperCase().slice(0, 20) ?? '';
  const signIn = useSession((s) => s.signIn);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      firstName: String(f.get('firstName') ?? '').trim(),
      lastName: String(f.get('lastName') ?? '').trim(),
      email: String(f.get('email') ?? '').trim(),
      phone: String(f.get('phone') ?? '').replace(/\s+/g, '') || undefined,
      password: String(f.get('password') ?? ''),
      marketingOptIn: f.get('marketingOptIn') === 'on',
      referralCode: String(f.get('referralCode') ?? '').trim().toUpperCase() || undefined,
    };
    // Client-side checks for instant feedback; the API validates everything again.
    const local: Record<string, string> = {};
    if (!body.firstName) local.firstName = 'First name is required';
    if (!body.lastName) local.lastName = 'Last name is required';
    if (!/^\S+@\S+\.\S+$/.test(body.email)) local.email = 'Enter a valid email address';
    if (body.phone && !/^\+233[2-5]\d{8}$/.test(body.phone)) local.phone = 'Enter a Ghana mobile number like +233241234567';
    if (!PASSWORD_RULE.test(body.password)) local.password = 'Use at least 10 characters with a letter and a number';
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;

    setLoading(true);
    try {
      signIn(await api<SessionPayload>('/auth/register', { method: 'POST', auth: false, body }));
      router.replace('/account');
    } catch (err) {
      const e2 = err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Something went wrong.');
      setErrors(e2.fieldErrors);
      setFormError(e2.message);
      setLoading(false);
    }
  }

  return (
    <AuthShell eyebrow="Join VÉLORA" title="Create your account" intro="Earn points from your first order. It takes under a minute.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="First name" name="firstName" autoComplete="given-name" required error={errors.firstName} />
          <Field label="Last name" name="lastName" autoComplete="family-name" required error={errors.lastName} />
        </div>
        <Field label="Email" name="email" type="email" autoComplete="email" required error={errors.email} />
        <Field label="Mobile number" name="phone" type="tel" autoComplete="tel" placeholder="+233 24 123 4567"
          hint="Optional. Used for delivery updates." error={errors.phone} />
        <Field label="Password" name="password" type="password" autoComplete="new-password" required
          hint="At least 10 characters, with a letter and a number." error={errors.password} />
        <Field label="Referral code" name="referralCode" defaultValue={ref} autoComplete="off" hint={ref ? 'A friend invited you: you’ll both get bonus points after your first order.' : 'Optional. Got one from a friend? Enter it here.'} error={errors.referralCode} />
        <Checkbox name="marketingOptIn" label="Send me new arrivals, sales and member offers. Unsubscribe any time." />
        <Button type="submit" size="lg" block loading={loading}>Create account</Button>
        <p className="text-center text-sm text-muted">
          Already a member? <Link href="/login" className="font-semibold text-ink underline underline-offset-4">Sign in</Link>
        </p>
      </form>
    </AuthShell>
  );
}
