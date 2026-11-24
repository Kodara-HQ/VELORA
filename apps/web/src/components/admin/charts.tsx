'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/format';

/**
 * Single-series column chart (one hue, no legend: the panel title names the series).
 * Thin columns with a 2px surface gap, rounded data-ends on the baseline, recessive grid,
 * per-column hover tooltip with a generous hit area, and a hidden data table for screen readers.
 */
export function RevenueBars({ data, height = 220 }: { data: Array<{ date: string; revenue: string; orders: number }>; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = data.map((d) => Number(d.revenue));
  const max = niceMax(Math.max(...values, 1));
  const W = 1000;
  const H = height;
  const padL = 56, padB = 24, padT = 8;
  const innerW = W - padL;
  const innerH = H - padB - padT;
  const slot = innerW / Math.max(data.length, 1);
  const barW = Math.max(2, slot - 2); // 2px surface gap between adjacent columns
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.ceil(data.length / 8);
  const h = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Daily revenue, ${data.length} days`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => {
          const y = padT + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={padL} x2={W} y1={y} y2={y} stroke="var(--color-line)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : '3 4'} />
              <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">{compact(t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const v = values[i];
          const bh = Math.max(v > 0 ? 2 : 0, (v / max) * innerH);
          const x = padL + i * slot + 1;
          const y = padT + innerH - bh;
          const r = Math.min(4, barW / 2, bh);
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.date}: ${formatMoney(d.revenue)}, ${d.orders} orders`}>
              {/* Hit target is the full column slot, larger than the mark. */}
              <rect x={padL + i * slot} y={padT} width={slot} height={innerH} fill="transparent" />
              {bh > 0 && (
                <path
                  d={`M${x},${y + bh} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + bh} Z`}
                  fill={hover === null || hover === i ? 'var(--color-ink)' : 'var(--color-stone)'}
                />
              )}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
                  {new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-sm border border-line bg-paper px-3 py-2 text-xs shadow-lg"
          style={{ left: `clamp(0px, calc(${((padL + hover * slot) / W) * 100}% - 60px), calc(100% - 150px))` }}>
          <p className="font-semibold">{new Date(h.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
          <p className="text-ink">{formatMoney(h.revenue)}</p>
          <p className="text-muted">{h.orders} order{h.orders === 1 ? '' : 's'}</p>
        </div>
      )}
      <table className="sr-only">
        <caption>Daily revenue</caption>
        <thead><tr><th>Date</th><th>Revenue</th><th>Orders</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.date}><td>{d.date}</td><td>{d.revenue}</td><td>{d.orders}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Horizontal magnitude bars (single hue) with values in text ink, for ranked lists. */
export function RankBars({ rows }: { rows: Array<{ label: string; value: number; display: string; sub?: string }> }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 font-semibold">{r.display}{r.sub && <span className="ml-1.5 font-normal text-muted">{r.sub}</span>}</span>
          </div>
          <div className="h-2 rounded-full bg-sand"><div className="h-2 rounded-full bg-ink" style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p / 0.5) * 0.5 * p;
}
function compact(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v));
}
