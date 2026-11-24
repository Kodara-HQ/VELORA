'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth-shell';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, type SessionPayload } from '@/lib/api';
import { safeNext } from '@/lib/format';
import { useSession } from '@/lib/session';

function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const signIn = useSession((s) => s.signIn);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const data = await api<SessionPayload>('/auth/login', {
        method: 'POST', auth: false,
        body: { email: form.get('email'), password: form.get('password') },
      });
      signIn(data);
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Something went wrong.'));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {error && <Alert tone="danger">{error.message}</Alert>}
      <Field label="Email" name="email" type="email" autoComplete="email" required error={error?.fieldErrors.email} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required error={error?.fieldErrors.password} />
      <div className="-mt-1 text-right text-sm">
        <Link href="/forgot-password" className="font-medium underline underline-offset-4 hover:text-rose-deep">Forgot your password?</Link>
      </div>
      <Button type="submit" size="lg" block loading={loading}>Sign in</Button>
      <p className="text-center text-sm text-muted">
        New to VÉLORA? <Link href="/register" className="font-semibold text-ink underline underline-offset-4">Create an account</Link>
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthShell eyebrow="Welcome back" title="Sign in" intro="Track orders, manage your wishlist and use your points.">
      <Suspense><LoginForm /></Suspense>
    </AuthShell>
  );
}
