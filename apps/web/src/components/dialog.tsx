'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';
import { cx } from './ui';

/** Accessible modal / drawer: focus moves in, Escape and backdrop close, background scroll locked. */
export function Dialog({ open, onClose, label, children, variant = 'center', className }: {
  open: boolean; onClose: () => void; label: string; children: ReactNode; variant?: 'center' | 'right'; className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" tabIndex={-1} aria-hidden="true" className="absolute inset-0 bg-ink/45" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={cx(
          'absolute flex flex-col bg-ivory shadow-2xl outline-none animate-fade-up',
          variant === 'right' ? 'inset-y-0 right-0 w-full max-w-md' : 'left-1/2 top-1/2 max-h-[92dvh] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-sm',
          className,
        )}
      >
        <button type="button" onClick={onClose} aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-paper/80 hover:bg-sand">
          <CloseIcon />
        </button>
        {children}
      </div>
    </div>
  );
}
