'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/shop';
import { cx } from './ui';

export function NewsletterForm({ dark = false }: { dark?: boolean }) {
  const [email, setEmail] = useState('');
  const m = useMutation({ mutationFn: (e: string) => api<{ message: string }>('/newsletter/subscribe', { method: 'POST', body: { email: e }, auth: false }) });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate(email);
  };

  if (m.isSuccess) return <p role="status" className={cx('text-sm', dark ? 'text-rose' : 'text-success')}>{m.data.message}</p>;
  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor={dark ? 'nl-footer' : 'nl-main'} className={cx('text-xs font-semibold uppercase tracking-[0.2em]', dark ? 'text-paper/60' : 'text-muted')}>
        Get new arrivals first
      </label>
      <div className="mt-2 flex">
        <input
          id={dark ? 'nl-footer' : 'nl-main'} type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Your email address" autoComplete="email"
          className={cx('h-11 min-w-0 flex-1 rounded-l-sm border px-3 text-sm focus:outline-none',
            dark ? 'border-paper/20 bg-transparent text-paper placeholder:text-paper/40 focus:border-paper' : 'border-line bg-paper focus:border-ink')}
        />
        <button type="submit" disabled={m.isPending}
          className={cx('h-11 rounded-r-sm px-4 text-xs font-semibold uppercase tracking-[0.12em] disabled:opacity-60', dark ? 'bg-rose text-ink' : 'bg-ink text-paper')}>
          {m.isPending ? 'Joining…' : 'Join'}
        </button>
      </div>
      {m.isError && <p role="alert" className={cx('mt-2 text-xs', dark ? 'text-rose' : 'text-danger')}>{errorMessage(m.error)}</p>}
    </form>
  );
}
