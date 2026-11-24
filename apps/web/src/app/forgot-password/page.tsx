'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ message: string }>('/auth/forgot-password', {
        method: 'POST', auth: false, body: { email: new FormData(e.currentTarget).get('email') },
      });
      setSent(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Something went wrong.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell eyebrow="Account help" title="Reset your password" intro="Enter your email and we'll send you a link to choose a new password.">
      {sent ? (
        <div className="flex flex-col gap-6">
          <Alert tone="success" title="Check your inbox">{sent}</Alert>
          <Link href="/login" className="text-sm font-semibold underline underline-offset-4">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {error && <Alert tone="danger">{error.message}</Alert>}
          <Field label="Email" name="email" type="email" autoComplete="email" required error={error?.fieldErrors.email} />
          <Button type="submit" size="lg" block loading={loading}>Send reset link</Button>
          <Link href="/login" className="text-center text-sm font-medium underline underline-offset-4">Back to sign in</Link>
        </form>
      )}
    </AuthShell>
  );
}
