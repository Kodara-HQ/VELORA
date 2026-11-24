'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { PaginationMeta } from '@velora/shared';
import { cx } from '@/lib/cx';
import { Alert, Badge, Button, Skeleton } from '../ui';
import { errorMessage } from '@/lib/shop';

export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-6">
      {back && <Link href={back.href} className="mb-2 inline-block text-xs font-semibold text-muted hover:text-ink">← {back.label}</Link>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold sm:text-[28px]">{title}</h1>
          {description && <div className="mt-1 text-sm text-muted">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Panel({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-md border border-line bg-paper', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          {title && <h2 className="text-sm font-bold">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={padded ? 'p-5' : undefined}>{children}</div>
    </section>
  );
}

/** Loading / error / empty wrapper so every admin screen handles all three states the same way. */
export function QueryState({ q, empty, emptyText = 'Nothing here yet.', rows = 5, children }: {
  q: { isPending: boolean; isError: boolean; error: unknown }; empty?: boolean; emptyText?: string; rows?: number; children: ReactNode;
}) {
  if (q.isPending) return <div className="space-y-2 p-4" aria-busy="true">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>;
  if (q.isError) return <div className="p-4"><Alert tone="danger">{errorMessage(q.error)}</Alert></div>;
  if (empty) return <p className="px-5 py-12 text-center text-sm text-muted">{emptyText}</p>;
  return <>{children}</>;
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.1em] text-muted">
            {head.map((h, i) => <th key={i} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx('px-4 py-3 align-middle', className)}>{children}</td>;

export function Pager({ meta, onPage }: { meta?: PaginationMeta; onPage: (p: number) => void }) {
  if (!meta || meta.totalPages <= 1) return meta ? <p className="border-t border-line px-4 py-3 text-xs text-muted">{meta.total} result{meta.total === 1 ? '' : 's'}</p> : null;
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs">
      <span className="text-muted">{(meta.page - 1) * meta.pageSize + 1}–{Math.min(meta.page * meta.pageSize, meta.total)} of {meta.total}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</Button>
        <Button size="sm" variant="secondary" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => v !== value && onChange(v), 300);
    return () => clearTimeout(t);
  }, [v, value, onChange]);
  return (
    <input type="search" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder}
      className="h-10 w-full min-w-0 rounded-sm border border-line bg-paper px-3 text-sm focus:border-ink focus:outline-none sm:w-72" />
  );
}

export function Select({ label, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className={cx('flex flex-col gap-1.5', className)}>
      <span className="text-xs font-semibold uppercase tracking-[0.1em]">{label}</span>
      <select className="h-11 rounded-sm border border-line bg-paper px-3 text-sm focus:border-ink focus:outline-none" {...rest}>{children}</select>
    </label>
  );
}

export function FilterSelect({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: Array<[string, string]> }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
      className="h-10 rounded-sm border border-line bg-paper px-3 text-sm focus:border-ink focus:outline-none">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function TextArea({ label, error, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.1em]">{label}</span>
      <textarea className={cx('min-h-24 rounded-sm border bg-paper p-3 text-sm focus:border-ink focus:outline-none', error ? 'border-danger' : 'border-line')} {...rest} />
      {error && <span role="alert" className="text-[13px] text-danger">{error}</span>}
    </label>
  );
}

const STATUS_TONE: Record<string, 'neutral' | 'ink' | 'rose' | 'success' | 'danger' | 'outline'> = {
  ACTIVE: 'success', DELIVERED: 'success', COMPLETED: 'success', RECEIVED: 'success', PAID: 'success', SUCCESS: 'success',
  DRAFT: 'neutral', PENDING: 'neutral', PENDING_PAYMENT: 'neutral', ORDERED: 'neutral', IN_TRANSIT: 'ink', SHIPPED: 'ink', PROCESSING: 'rose', PARTIALLY_RECEIVED: 'rose',
  PENDING_REVIEW: 'rose', ARCHIVED: 'outline', CANCELLED: 'danger', REJECTED: 'danger', SUSPENDED: 'danger', FAILED: 'danger', REFUNDED: 'outline', UNPAID: 'outline',
};
export const humanize = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export function StatusPill({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{humanize(status)}</Badge>;
}

export function KpiTile({ label, value, change, hint }: { label: string; value: ReactNode; change?: number; hint?: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-paper p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-2 font-display text-[28px] font-extrabold leading-none tracking-tight">{value}</p>
      <p className="mt-2 text-xs text-muted">
        {change !== undefined && (
          <span className={cx('mr-1.5 font-semibold', change > 0 ? 'text-success' : change < 0 ? 'text-danger' : 'text-muted')}>
            <span aria-hidden="true">{change > 0 ? '▲' : change < 0 ? '▼' : '■'}</span> {Math.abs(change)}%
            <span className="sr-only">{change >= 0 ? 'up' : 'down'} vs previous period</span>
          </span>
        )}
        {hint}
      </p>
    </div>
  );
}

export function Forbidden() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-2xl font-extrabold">You don’t have access to this area</h1>
      <p className="mt-2 text-sm text-muted">Ask a Super Administrator to grant your role this permission.</p>
    </div>
  );
}
