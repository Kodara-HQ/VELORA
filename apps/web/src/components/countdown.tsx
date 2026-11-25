'use client';

import { useEffect, useState } from 'react';

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}
const pad = (n: number) => String(n).padStart(2, '0');

/** Live countdown to `to`. Renders a stable placeholder on the server so hydration never mismatches. */
export function Countdown({ to, className, onDone }: { to: string; className?: string; onDone?: () => void }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = now == null ? null : new Date(to).getTime() - now;
  useEffect(() => { if (left != null && left <= 0) onDone?.(); }, [left, onDone]);
  if (left == null) return <span className={className}>--:--:--</span>;
  const p = parts(left);
  const label = `${p.d ? `${p.d} day${p.d === 1 ? '' : 's'}, ` : ''}${p.h} hours, ${p.m} minutes`;
  return (
    <span className={className} role="timer" aria-label={label}>
      <span aria-hidden="true" className="tabular-nums">{p.d > 0 && `${p.d}d `}{pad(p.h)}:{pad(p.m)}:{pad(p.s)}</span>
    </span>
  );
}
