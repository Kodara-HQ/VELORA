import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, errorMessage } from '@/api';
import { money } from '@/format';
import { useCartMutations, useWishlist } from '@/shop';
import { colors, space, type } from '@/theme';
import type { ProductCard as Card, ProductDetail } from '@/types';
import { Button, Countdown, Empty, Loading, Notice, Price, Rail, styles } from '@/ui';

export default function ProductScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { width } = useWindowDimensions();
  const q = useQuery({ queryKey: ['product', slug], queryFn: () => api<ProductDetail>(`/products/${slug}`) });
  const related = useQuery({ queryKey: ['related', slug], queryFn: () => api<{ similar: Card[]; completeTheLook: Card[] }>(`/products/${slug}/related`, { auth: false }) });
  const { add } = useCartMutations();
  const { ids, toggle } = useWishlist();
  const p = q.data;

  const colorsList = useMemo(() => [...new Map((p?.variants ?? []).filter((v) => v.color).map((v) => [v.color!, v.colorHex])).entries()], [p]);
  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (p && color === null) setColor(p.variants.find((v) => v.available > 0)?.color ?? p.variants[0]?.color ?? null);
  }, [p, color]);
  // Record the view (feeds "recently viewed" and recommendations).
  useEffect(() => { if (p) void api(`/products/${p.id}/views`, { method: 'POST', body: {} }).catch(() => undefined); }, [p]);

  if (q.isPending) return <Loading />;
  if (q.isError || !p) return <Empty title="This piece isn’t available" body={errorMessage(q.error)} action={<Button title="Keep shopping" onPress={() => router.replace('/(tabs)/shop')} />} />;

  const forColor = p.variants.filter((v) => !color || v.color === color);
  const sizes = forColor.filter((v) => v.size);
  const variant = forColor.length === 1 && !forColor[0].size ? forColor[0] : forColor.find((v) => v.size === size) ?? null;
  const images = p.images.filter((i) => i.color === color).length ? p.images.filter((i) => i.color === color) : p.images;
  const saved = ids.has(p.id);

  const addToBag = () => {
    if (!variant) return;
    add.mutate({ variantId: variant.id, quantity: 1 }, { onSuccess: () => { setAdded(true); setTimeout(() => setAdded(false), 2500); } });
  };

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: '', headerRight: () => (
        <Pressable onPress={() => toggle(p.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={saved ? 'Remove from wishlist' : 'Save to wishlist'}>
          <Ionicons name={saved ? 'heart' : 'heart-outline'} size={24} color={saved ? colors.roseDeep : colors.ink} />
        </Pressable>
      ) }} />
      <ScrollView contentContainerStyle={{ paddingBottom: space(8) }}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} accessibilityLabel="Product images">
          {images.map((img) => (
            <Image key={img.id} source={{ uri: img.url }} style={{ width, height: width * 4 / 3, backgroundColor: colors.sand }} contentFit="cover" accessibilityLabel={img.alt} />
          ))}
        </ScrollView>
        <View style={{ padding: space(4) }}>
          {p.brand && <Text style={styles.brand}>{p.brand.name}</Text>}
          <Text style={[type.h1, { marginTop: 4 }]}>{p.name}</Text>
          <View style={[styles.row, { gap: 10, marginTop: 6, flexWrap: 'wrap' }]}>
            {p.reviewCount > 0 && <Text style={type.small}>★ {p.rating.toFixed(1)} · {p.reviewCount} reviews</Text>}
            {p.vendor && <Pressable onPress={() => router.push(`/search?q=${encodeURIComponent(p.vendor!.name)}`)}><Text style={[type.small, { textDecorationLine: 'underline' }]}>Sold by {p.vendor.name}</Text></Pressable>}
          </View>
          <View style={{ marginTop: space(3) }}><Price price={variant?.price ?? p.price} compareAt={variant?.compareAtPrice ?? p.compareAtPrice} size={22} /></View>

          {p.promotion && (
            <Pressable onPress={() => router.push(`/sale/${p.promotion!.slug}`)} style={{ marginTop: space(3), backgroundColor: colors.ink, padding: space(3), borderRadius: 2 }}>
              <Text style={{ color: colors.rose, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>{p.promotion.type === 'FLASH_SALE' ? 'FLASH SALE' : 'SALE'} -{p.promotion.percentOff}% · {p.promotion.name.toUpperCase()}</Text>
              <Text style={{ color: colors.paper, marginTop: 2 }}>Ends in <Countdown to={p.promotion.endsAt} onDone={() => void q.refetch()} style={{ fontWeight: '700', color: colors.paper }} />
                {p.promotion.stockLeft != null && `  ·  Only ${p.promotion.stockLeft} left at this price`}</Text>
            </Pressable>
          )}

          {colorsList.length > 0 && (
            <View style={{ marginTop: space(5) }}>
              <Text style={styles.label}>Colour: <Text style={{ fontWeight: '400', textTransform: 'none' }}>{color}</Text></Text>
              <View style={[styles.row, { gap: space(3), flexWrap: 'wrap' }]}>
                {colorsList.map(([c, hex]) => (
                  <Pressable key={c} onPress={() => { setColor(c); setSize(null); }} accessibilityRole="radio" accessibilityState={{ checked: color === c }} accessibilityLabel={c}
                    style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: color === c ? colors.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: hex ?? colors.sand, borderWidth: 1, borderColor: colors.line }} />
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {sizes.length > 0 && (
            <View style={{ marginTop: space(5) }}>
              <Text style={styles.label}>Size</Text>
              <View style={[styles.row, { gap: space(2), flexWrap: 'wrap' }]}>
                {sizes.map((v) => {
                  const out = v.available <= 0;
                  const active = size === v.size;
                  return (
                    <Pressable key={v.id} disabled={out} onPress={() => setSize(v.size)} accessibilityRole="radio" accessibilityState={{ checked: active, disabled: out }}
                      accessibilityLabel={`${v.size}${out ? ', sold out' : v.lowStock ? `, only ${v.available} left` : ''}`}
                      style={{ minWidth: 52, height: 44, paddingHorizontal: space(3), borderWidth: 1, borderColor: active ? colors.ink : colors.line, backgroundColor: active ? colors.ink : colors.paper, alignItems: 'center', justifyContent: 'center', opacity: out ? 0.35 : 1 }}>
                      <Text style={{ color: active ? colors.paper : colors.ink, fontWeight: '600', textDecorationLine: out ? 'line-through' : 'none' }}>{v.size}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {variant?.lowStock && <Text style={{ color: colors.roseDeep, fontWeight: '600', marginTop: 8 }}>Only {variant.available} left</Text>}
            </View>
          )}

          <View style={{ marginTop: space(6) }}>
            {add.isError && <Notice tone="danger">{errorMessage(add.error)}</Notice>}
            {added && <Notice tone="success">Added to your bag.</Notice>}
            <Button title={variant ? (variant.available > 0 ? 'Add to bag' : 'Sold out') : 'Choose a size'} icon="bag-outline" onPress={addToBag} loading={add.isPending} disabled={!variant || variant.available <= 0} />
            {added && <Button title="View bag" variant="secondary" style={{ marginTop: space(2) }} onPress={() => router.push('/(tabs)/bag')} />}
          </View>

          {p.shortDescription && <Text style={[type.body, { marginTop: space(6), color: colors.muted }]}>{p.shortDescription}</Text>}
          {p.description && p.description !== p.shortDescription && <Text style={[type.body, { marginTop: space(3) }]}>{p.description}</Text>}
          {(p.material || p.attributes.length > 0) && (
            <View style={{ marginTop: space(4), gap: 4 }}>
              {p.material && <Text style={type.small}>Material: <Text style={{ color: colors.ink }}>{p.material}</Text></Text>}
              {p.attributes.filter((a) => a.name !== 'Material').map((a) => <Text key={a.name} style={type.small}>{a.name}: <Text style={{ color: colors.ink }}>{a.value}</Text></Text>)}
            </View>
          )}
          <View style={{ marginTop: space(5), borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space(4), gap: 6 }}>
            {p.delivery.map((d) => (
              <Text key={d.zone} style={{ fontSize: 13 }}><Text style={{ fontWeight: '700' }}>{d.zone}:</Text> {d.minDays === d.maxDays ? `${d.maxDays} days` : `${d.minDays}–${d.maxDays} days`} · {money(d.fee)}{d.freeOver ? ` (free over ${money(d.freeOver)})` : ''}</Text>
            ))}
            <Text style={{ fontSize: 13 }}>Pay cash or MoMo on delivery · 14-day returns</Text>
          </View>
        </View>
        <Rail title="Complete the look" products={related.data?.completeTheLook ?? []} />
        <Rail title="You may also like" products={related.data?.similar ?? []} />
      </ScrollView>
    </SafeAreaView>
  );
}
