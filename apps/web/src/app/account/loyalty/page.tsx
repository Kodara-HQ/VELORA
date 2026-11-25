'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Button, Skeleton } from '@/components/ui';
import { api, apiWithMeta } from '@/lib/api';
import { cx } from '@/lib/cx';
import { formatMoney } from '@/lib/format';
import { errorMessage } from '@/lib/shop';
import type { LoyaltySummary } from '@/lib/types';

interface Txn { id: number; type: string; points: number; balanceAfter: number; description: string | null; createdAt: string; orderNumber: string | null }
const TIERS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'] as const;
const title = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();
const TYPE_LABEL: Record<string, string> = { EARN: 'Earned', REDEEM: 'Used', REVERSAL: 'Reversed', ADJUST: 'Adjusted', REFERRAL_BONUS: 'Referral bonus', REVIEW_BONUS: 'Review bonus', EXPIRE: 'Expired' };

export default function LoyaltyPage() {
  const q = useQuery({ queryKey: ['my-loyalty'], queryFn: () => api<LoyaltySummary>('/me/loyalty') });
  const history = useInfiniteQuery({
    queryKey: ['my-loyalty-history'],
    queryFn: ({ pageParam }) => apiWithMeta<Txn[]>(`/me/loyalty/transactions?page=${pageParam}&pageSize=15`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta && last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  if (q.isPending) return <Skeleton className="h-96" />;
  if (q.isError) return <Alert tone="danger">{errorMessage(q.error)}</Alert>;
  const l = q.data;
  const link = `${origin}/register?ref=${l.referral.code}`;
  const progress = l.nextTier ? Math.min(100, ((l.lifetimePoints - l.nextTier.currentMin) / (l.nextTier.min - l.nextTier.currentMin)) * 100) : 100;
  const rows = history.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-extrabold">VÉLORA Rewards</h1>
      <section className="grid gap-px overflow-hidden rounded-sm bg-line md:grid-cols-[1.2fr_1fr]">
        <div className="bg-ink p-6 text-paper sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-rose">{title(l.tier)} member · {l.multiplier}× points</p>
          <p className="mt-3 font-display text-5xl font-extrabold">{l.pointsBalance.toLocaleString()}</p>
          <p className="text-sm text-paper/70">points · worth {formatMoney(l.pointsValue)} at checkout</p>
          {l.nextTier ? (
            <div className="mt-6">
              <div className="h-2 overflow-hidden rounded-full bg-paper/15" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress to ${title(l.nextTier.tier)}`}>
                <div className="h-full bg-rose" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-sm text-paper/80">{l.nextTier.pointsNeeded.toLocaleString()} more lifetime points to {title(l.nextTier.tier)}</p>
            </div>
          ) : <p className="mt-6 text-sm text-paper/80">You’ve reached our top tier. Thank you.</p>}
        </div>
        <div className="bg-paper p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Your perks</p>
          <ul className="mt-3 space-y-2 text-sm">{l.perks.map((p) => <li key={p}>✓ {p}</li>)}</ul>
          <ol className="mt-6 flex gap-1.5" aria-label="Tiers">
            {TIERS.map((t) => (
              <li key={t} className={cx('flex-1 rounded-sm px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wider', t === l.tier ? 'bg-ink text-paper' : 'bg-sand text-muted')}>{title(t)}</li>
            ))}
          </ol>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-sm border border-line bg-paper p-6">
          <h2 className="text-lg font-extrabold">How it works</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted">
            <li>Earn {l.rules.pointsPerCedi} point per GH₵1 on delivered orders ({l.multiplier}× at your tier).</li>
            <li>Every {Math.round(1 / l.rules.cediPerPoint)} points = GH₵1 off. Use {l.rules.minRedeemPoints}+ points, up to {l.rules.maxRedeemPercent}% of your items, at checkout.</li>
            <li>Get {l.rules.reviewBonusPoints} points for each published review of something you bought.</li>
          </ul>
        </div>
        <div className="rounded-sm border border-line bg-paper p-6">
          <h2 className="text-lg font-extrabold">Invite a friend</h2>
          <p className="mt-2 text-sm text-muted">They get {l.referral.friendBonusPoints} points and you get {l.referral.bonusPoints} when their first order is delivered.</p>
          <div className="mt-4 flex gap-2">
            <input readOnly value={origin ? link : l.referral.code} aria-label="Your referral link" className="h-11 min-w-0 flex-1 rounded-sm border border-line bg-ivory px-3 text-sm" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select instead */ } }}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
          <p className="mt-2 text-xs text-muted">Code <b className="text-ink">{l.referral.code}</b> · {l.referral.invited} invited · {l.referral.rewarded} rewarded</p>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-extrabold">Points history</h2>
        {history.isPending ? <Skeleton className="h-40" /> : !rows.length ? <p className="text-sm text-muted">No points activity yet. You’ll earn points when your first order is delivered.</p> : (
          <ul className="divide-y divide-line rounded-sm border border-line bg-paper">
            {rows.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{TYPE_LABEL[t.type] ?? t.type}</span>
                  <span className="block truncate text-xs text-muted">{t.description} · {new Date(t.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </span>
                <span className="text-right">
                  <b className={t.points > 0 ? 'text-success' : 'text-rose-deep'}>{t.points > 0 ? '+' : ''}{t.points.toLocaleString()}</b>
                  <span className="block text-xs text-muted">bal. {t.balanceAfter.toLocaleString()}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {history.hasNextPage && <Button variant="secondary" className="mt-3" onClick={() => history.fetchNextPage()} loading={history.isFetchingNextPage}>Show more</Button>}
      </section>
    </div>
  );
}
