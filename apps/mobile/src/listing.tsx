import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { apiWithMeta, errorMessage, qs } from './api';
import { colors, space, type } from './theme';
import type { ProductCard as Card } from './types';
import { Button, Empty, Loading, Notice, ProductCard, styles } from './ui';

const SORTS: Array<[string, string]> = [['recommended', 'Recommended'], ['newest', 'Newest'], ['popular', 'Best selling'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['rating', 'Top rated']];

interface SearchMeta { query: string; correctedFrom: string | null }

/** Infinite product grid for a category, search, sale or shop, with sort and quick filters. */
export function ProductList({ params, header, emptyTitle = 'Nothing here yet', emptyBody }: {
  params: Record<string, string | undefined>; header?: ReactNode; emptyTitle?: string; emptyBody?: string;
}) {
  const { width } = useWindowDimensions();
  const [sort, setSort] = useState(params.sort ?? 'recommended');
  const [inStock, setInStock] = useState(false);
  const [onSale, setOnSale] = useState(params.onSale === 'true');
  const [sorting, setSorting] = useState(false);
  const base = { ...params, sort, inStock: inStock || undefined, onSale: onSale || undefined, pageSize: 20 };
  const q = useInfiniteQuery({
    queryKey: ['products', base],
    queryFn: ({ pageParam }) => apiWithMeta<Card[]>(`/products${qs({ ...base, page: pageParam })}`, { auth: false }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta && last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  const meta = q.data?.pages[0]?.meta as { total: number; search?: SearchMeta } | undefined;
  const col = (width - space(4) * 2 - space(3)) / 2;
  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}
      style={{ paddingHorizontal: space(3), paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: active ? colors.ink : colors.line, backgroundColor: active ? colors.ink : colors.paper }}>
      <Text style={{ fontSize: 13, color: active ? colors.paper : colors.ink }}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <FlatList
        data={items}
        keyExtractor={(p) => String(p.id)}
        numColumns={2}
        columnWrapperStyle={{ gap: space(3), paddingHorizontal: space(4) }}
        contentContainerStyle={{ gap: space(6), paddingBottom: space(12) }}
        renderItem={({ item }) => <ProductCard product={item} width={col} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
        onEndReachedThreshold={0.6}
        refreshing={q.isRefetching && !q.isFetchingNextPage}
        onRefresh={() => q.refetch()}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: space(4), paddingTop: space(3) }}>
            {header}
            {meta?.search?.correctedFrom && <Notice>No results for “{meta.search.correctedFrom}”. Showing “{meta.search.query}” instead.</Notice>}
            <View style={[styles.row, { gap: space(2), flexWrap: 'wrap', marginBottom: space(2) }]}>
              {chip(SORTS.find(([v]) => v === sort)?.[1] ?? 'Sort', false, () => setSorting(true))}
              {chip('In stock', inStock, () => setInStock(!inStock))}
              {params.promotion ? null : chip('On sale', onSale, () => setOnSale(!onSale))}
            </View>
            {meta && <Text style={[type.small, { marginBottom: space(2) }]}>{meta.total} {meta.total === 1 ? 'item' : 'items'}</Text>}
          </View>
        }
        ListEmptyComponent={q.isPending ? <Loading /> : q.isError ? (
          <View style={{ padding: space(4) }}><Notice tone="danger">{errorMessage(q.error)}</Notice><Button title="Try again" variant="secondary" onPress={() => q.refetch()} /></View>
        ) : <Empty title={emptyTitle} body={emptyBody ?? 'Try removing a filter.'} />}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.ink} style={{ margin: space(6) }} /> : null}
      />
      <Modal visible={sorting} transparent animationType="slide" onRequestClose={() => setSorting(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} onPress={() => setSorting(false)} accessibilityLabel="Close" />
        <View style={{ backgroundColor: colors.paper, padding: space(4), paddingBottom: space(10) }}>
          <Text style={[type.h2, { marginBottom: space(3) }]}>Sort by</Text>
          {SORTS.map(([v, label]) => (
            <Pressable key={v} onPress={() => { setSort(v); setSorting(false); }} style={[styles.row, { paddingVertical: space(3), justifyContent: 'space-between' }]} accessibilityRole="radio" accessibilityState={{ checked: sort === v }}>
              <Text style={{ fontSize: 16, fontWeight: sort === v ? '700' : '400' }}>{label}</Text>
              {sort === v && <Ionicons name="checkmark" size={20} color={colors.ink} />}
            </Pressable>
          ))}
        </View>
        </View>
      </Modal>
    </>
  );
}
