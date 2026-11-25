import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Share, Text, View } from 'react-native';
import { api, apiWithMeta, errorMessage } from '@/api';
import { money, shortDate } from '@/format';
import { colors, space, type } from '@/theme';
import type { LoyaltySummary } from '@/types';
import { Button, Loading, Notice, Screen, styles } from '@/ui';

interface Txn { id: number; type: string; points: number; balanceAfter: number; description: string | null; createdAt: string }
const LABEL: Record<string, string> = { EARN: 'Earned', REDEEM: 'Used', REVERSAL: 'Reversed', ADJUST: 'Adjusted', REFERRAL_BONUS: 'Referral bonus', REVIEW_BONUS: 'Review bonus', EXPIRE: 'Expired' };
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3000';

export default function LoyaltyScreen() {
  const q = useQuery({ queryKey: ['my-loyalty'], queryFn: () => api<LoyaltySummary>('/me/loyalty') });
  const h = useInfiniteQuery({
    queryKey: ['my-loyalty-history'],
    queryFn: ({ pageParam }) => apiWithMeta<Txn[]>(`/me/loyalty/transactions?page=${pageParam}&pageSize=20`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta && last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });
  const l = q.data;
  const rows = h.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <Stack.Screen options={{ title: 'Rewards' }} />
      {q.isPending ? <Loading /> : q.isError || !l ? <Screen edges={[]}><Notice tone="danger">{errorMessage(q.error)}</Notice></Screen> : (
        <Screen edges={[]} refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); void h.refetch(); }}>
          <View style={{ backgroundColor: colors.ink, padding: space(5) }}>
            <Text style={{ color: colors.rose, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>{l.tier} MEMBER · {l.multiplier}× POINTS</Text>
            <Text style={{ color: colors.paper, fontSize: 40, fontWeight: '800', marginTop: 6 }}>{l.pointsBalance.toLocaleString()}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.75)' }}>points · worth {money(l.pointsValue)} at checkout</Text>
            {l.nextTier && (
              <View style={{ marginTop: space(4) }}>
                <View style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 3 }} accessibilityRole="progressbar">
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.rose, width: `${Math.min(100, ((l.lifetimePoints - l.nextTier.currentMin) / (l.nextTier.min - l.nextTier.currentMin)) * 100)}%` }} />
                </View>
                <Text style={{ color: 'rgba(255,255,255,0.8)', marginTop: 6, fontSize: 13 }}>{l.nextTier.pointsNeeded.toLocaleString()} more lifetime points to {l.nextTier.tier.toLowerCase()}</Text>
              </View>
            )}
          </View>
          <View style={[styles.card, { marginTop: space(4) }]}>
            <Text style={type.h2}>Your perks</Text>
            {l.perks.map((p) => <Text key={p} style={{ marginTop: 6 }}>✓ {p}</Text>)}
          </View>
          <View style={[styles.card, { marginTop: space(4) }]}>
            <Text style={type.h2}>Invite a friend</Text>
            <Text style={[type.small, { marginTop: 4 }]}>They get {l.referral.friendBonusPoints} points and you get {l.referral.bonusPoints} when their first order is delivered.</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', letterSpacing: 2, marginVertical: space(3) }}>{l.referral.code}</Text>
            <Button title="Share invite" variant="secondary" icon="share-outline"
              onPress={() => Share.share({ message: `Join me on VÉLORA and get ${l.referral.friendBonusPoints} bonus points: ${WEB_URL}/register?ref=${l.referral.code}` })} />
            <Text style={[type.small, { marginTop: space(2) }]}>{l.referral.invited} invited · {l.referral.rewarded} rewarded</Text>
          </View>
          <Text style={[type.h2, { marginTop: space(6), marginBottom: space(2) }]}>Points history</Text>
          {h.isPending ? <Loading /> : !rows.length ? <Text style={type.small}>No points activity yet.</Text> : rows.map((t) => (
            <View key={t.id} style={[styles.row, { justifyContent: 'space-between', paddingVertical: space(3), borderBottomWidth: 1, borderBottomColor: colors.line }]}>
              <View style={{ flex: 1, paddingRight: space(3) }}>
                <Text style={{ fontWeight: '600' }}>{LABEL[t.type] ?? t.type}</Text>
                <Text style={type.small} numberOfLines={1}>{t.description} · {shortDate(t.createdAt)}</Text>
              </View>
              <Text style={{ fontWeight: '800', color: t.points > 0 ? colors.success : colors.roseDeep }}>{t.points > 0 ? '+' : ''}{t.points.toLocaleString()}</Text>
            </View>
          ))}
          {h.hasNextPage && <Button title="Show more" variant="secondary" style={{ marginTop: space(3) }} loading={h.isFetchingNextPage} onPress={() => h.fetchNextPage()} />}
        </Screen>
      )}
    </>
  );
}
