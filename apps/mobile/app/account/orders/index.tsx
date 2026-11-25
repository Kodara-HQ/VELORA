import { useInfiniteQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { apiWithMeta, errorMessage } from '@/api';
import { humanize, money, shortDate } from '@/format';
import { colors, space, type } from '@/theme';
import type { OrderSummary } from '@/types';
import { Badge, Button, Empty, Loading, Notice } from '@/ui';

export default function OrdersScreen() {
  const q = useInfiniteQuery({
    queryKey: ['my-orders'],
    queryFn: ({ pageParam }) => apiWithMeta<OrderSummary[]>(`/me/orders?page=${pageParam}&pageSize=15`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta && last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <Stack.Screen options={{ title: 'Orders' }} />
      <FlatList
        data={rows}
        keyExtractor={(o) => o.orderNumber}
        contentContainerStyle={{ padding: space(4), gap: space(3) }}
        refreshing={q.isRefetching && !q.isFetchingNextPage}
        onRefresh={() => q.refetch()}
        onEndReached={() => q.hasNextPage && q.fetchNextPage()}
        renderItem={({ item: o }) => (
          <Pressable onPress={() => router.push(`/account/orders/${o.orderNumber}`)} accessibilityRole="button"
            style={{ backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, padding: space(4), gap: space(2) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700' }}>{o.orderNumber}</Text>
              <Badge tone={o.status === 'DELIVERED' || o.status === 'COMPLETED' ? 'success' : o.status === 'CANCELLED' ? 'neutral' : 'ink'}>{humanize(o.status)}</Badge>
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {o.previews.map((p, i) => <View key={i} style={{ width: 44, height: 58, backgroundColor: colors.sand }}>{p.image && <Image source={{ uri: p.image }} style={{ flex: 1 }} contentFit="cover" />}</View>)}
            </View>
            <Text style={type.small}>{shortDate(o.placedAt)} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'} · <Text style={{ color: colors.ink, fontWeight: '700' }}>{money(o.grandTotal)}</Text></Text>
          </Pressable>
        )}
        ListEmptyComponent={q.isPending ? <Loading /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice>
          : <Empty title="No orders yet" body="When you place an order, you can track it here." action={<Button title="Start shopping" onPress={() => router.push('/(tabs)/shop')} />} />}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.ink} /> : null}
      />
    </>
  );
}
