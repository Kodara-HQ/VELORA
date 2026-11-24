import type { ReactNode } from 'react';
import { Container } from './ui';

/** Split editorial layout shared by sign-in, registration and password pages. */
export function AuthShell({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: string; children: ReactNode }) {
  return (
    <Container className="grid gap-10 py-10 sm:py-16 lg:grid-cols-[1fr_minmax(0,460px)] lg:gap-20">
      <aside className="hidden flex-col justify-between rounded-sm bg-rose p-10 lg:flex">
        <p className="text-xs font-semibold uppercase tracking-[0.3em]">VÉLORA Members</p>
        <div>
          <p className="font-display text-5xl font-extrabold leading-[0.95] tracking-tight">Define<br />your<br />style.</p>
          <p className="mt-6 max-w-xs text-sm leading-relaxed">
            Members earn points on every order, get early access to drops, and track deliveries from checkout to doorstep.
          </p>
        </div>
      </aside>
      <div className="animate-fade-up">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-deep">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">{title}</h1>
        {intro && <p className="mt-3 text-[15px] text-muted">{intro}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </Container>
  );
}
