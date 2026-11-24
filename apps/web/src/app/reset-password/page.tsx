'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <Alert tone="warning" title="This link is incomplete">
        Open the link from your email again, or <Link href="/forgot-password" className="underline">request a new one</Link>.
      </Alert>
    );
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get('password'));
    if (password !== String(f.get('confirm'))) {
      setErrors({ confirm: 'Passwords do not match' });
      return;
    }
    setErrors({});
    setFormError(null);
    setLoading(true);
    try {
      await api('/auth/reset-password', { method: 'POST', auth: false, body: { token, password } });
      setDone(true);
    } catch (err) {
      const e2 = err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Something went wrong.');
      setErrors(e2.fieldErrors);
      setFormError(e2.message);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-6">
        <Alert tone="success" title="Password updated">You've been signed out on all devices. Sign in with your new password.</Alert>
        <Link href="/login" className="text-sm font-semibold underline underline-offset-4">Sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Field label="New password" name="password" type="password" autoComplete="new-password" required
        hint="At least 10 characters, with a letter and a number." error={errors.password} />
      <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required error={errors.confirm} />
      <Button type="submit" size="lg" block loading={loading}>Update password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell eyebrow="Account help" title="Choose a new password">
      <Suspense><ResetForm /></Suspense>
    </AuthShell>
  );
}
