'use client';

import Link from 'next/link';
import { forwardRef, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/* ─────────── Logo ─────────── */

export function Logo({ className, tagline = false }: { className?: string; tagline?: boolean }) {
  return (
    <span className={cx('inline-flex flex-col leading-none', className)}>
      <span className="font-display text-[1.45em] font-extrabold tracking-[0.18em]">VÉLORA</span>
      {tagline && <span className="mt-1 text-[0.5em] font-medium uppercase tracking-[0.32em] text-muted">Define your style</span>}
    </span>
  );
}

/* ─────────── Button ─────────── */

type Variant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-ink text-paper hover:bg-ink-soft disabled:bg-stone',
  secondary: 'bg-paper text-ink border border-ink hover:bg-ink hover:text-paper disabled:border-stone disabled:text-stone disabled:hover:bg-paper',
  ghost: 'bg-transparent text-ink hover:bg-sand disabled:text-stone',
  accent: 'bg-rose text-ink hover:bg-[#cf8f97] disabled:opacity-60',
  danger: 'bg-paper text-danger border border-danger hover:bg-danger hover:text-paper',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-xs',
  md: 'h-11 px-6 text-sm',
  lg: 'h-14 px-8 text-sm',
};
const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-sm font-semibold uppercase tracking-[0.12em] transition-colors duration-200 ease-out disabled:cursor-not-allowed select-none';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(buttonBase, variants[variant], sizes[size], block && 'w-full', className)}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = 'primary', size = 'md', block, className, children }: {
  href: string; variant?: Variant; size?: Size; block?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <Link href={href} className={cx(buttonBase, variants[variant], sizes[size], block && 'w-full', className)}>
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ─────────── Form fields ─────────── */

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, error, hint, id, className, type, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-[0.1em] text-ink">
        {label}
        {rest.required && <span aria-hidden="true" className="text-rose-deep"> *</span>}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          type={isPassword && reveal ? 'text' : type}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy}
          className={cx(
            'h-12 w-full rounded-sm border bg-paper px-4 text-[15px] text-ink placeholder:text-stone transition-colors',
            'focus:border-ink focus:outline-none focus-visible:outline-none focus:ring-1 focus:ring-ink',
            error ? 'border-danger' : 'border-line hover:border-stone',
            isPassword && 'pr-16',
          )}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="absolute inset-y-0 right-0 px-4 text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink"
            aria-label={reveal ? 'Hide password' : 'Show password'}
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="text-[13px] text-danger" role="alert">{error}</p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm text-ink">
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-ink" {...rest} />
      <span>{label}</span>
    </label>
  );
}

/* ─────────── Feedback ─────────── */

const tones = {
  info: 'bg-sand text-ink border-line',
  success: 'bg-success-soft text-success border-success/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
  warning: 'bg-warning-soft text-warning border-warning/30',
} as const;

export function Alert({ tone = 'info', title, children }: { tone?: keyof typeof tones; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('rounded-sm border px-4 py-3 text-sm animate-fade-up', tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cx(title && 'mt-0.5')}>{children}</div>}
    </div>
  );
}

const badgeTones = {
  neutral: 'bg-sand text-ink',
  ink: 'bg-ink text-paper',
  rose: 'bg-rose text-ink',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  outline: 'border border-ink text-ink',
} as const;

export function Badge({ tone = 'neutral', children, className }: { tone?: keyof typeof badgeTones; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em]', badgeTones[tone], className)}>
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx('rounded-sm bg-[linear-gradient(90deg,#ede9e3_0%,#f6f3ee_50%,#ede9e3_100%)] bg-[length:200%_100%] animate-shimmer', className)}
    />
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-rose-soft text-rose-deep">
        {icon ?? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M6 7h12l-1 13H7L6 7Z" /><path d="M9 7a3 3 0 0 1 6 0" />
          </svg>
        )}
      </div>
      <h3 className="text-lg font-bold">{title}</h3>
      {body && <p className="mt-2 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-sm border border-line bg-paper', className)}>{children}</section>;
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-10', className)}>{children}</div>;
}
