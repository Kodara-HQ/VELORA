import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { money, percentOff } from './format';
import { useWishlist } from './shop';
import { colors, space, type } from './theme';
import type { ProductCard as Card } from './types';

export function Screen({ children, scroll = true, refreshing, onRefresh, padded = true, edges = ['top'] }: {
  children: ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; padded?: boolean; edges?: Array<'top' | 'bottom'>;
}) {
  const body = scroll ? (
    <ScrollView contentContainerStyle={[padded && styles.pad, { paddingBottom: space(10) }]} keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.ink} /> : undefined}>
      {children}
    </ScrollView>
  ) : <View style={[{ flex: 1 }, padded && styles.pad]}>{children}</View>;
  return <SafeAreaView style={styles.screen} edges={edges}>{body}</SafeAreaView>;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, style, icon }: {
  title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; loading?: boolean; disabled?: boolean;
  style?: StyleProp<ViewStyle>; icon?: keyof typeof Ionicons.glyphMap;
}) {
  const off = disabled || loading;
  const v = { primary: [colors.ink, colors.paper, colors.ink], secondary: [colors.paper, colors.ink, colors.ink], ghost: ['transparent', colors.ink, 'transparent'], danger: [colors.paper, colors.danger, colors.danger] }[variant];
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!loading }} disabled={off} onPress={onPress}
      style={({ pressed }) => [styles.btn, { backgroundColor: v[0], borderColor: v[2], opacity: off ? 0.45 : pressed ? 0.8 : 1 }, style]}>
      {loading ? <ActivityIndicator color={v[1]} /> : (
        <View style={styles.row}>
          {icon && <Ionicons name={icon} size={18} color={v[1]} style={{ marginRight: 8 }} />}
          <Text style={[styles.btnText, { color: v[1] }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Field({ label, error, hint, ...rest }: TextInputProps & { label: string; error?: string; hint?: string }) {
  return (
    <View style={{ marginBottom: space(4) }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} {...rest} accessibilityLabel={label}
        style={[styles.input, error ? { borderColor: colors.danger } : null, rest.editable === false && { backgroundColor: colors.sand }]} />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : hint ? <Text style={[type.small, { marginTop: 4 }]}>{hint}</Text> : null}
    </View>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'danger' | 'success' | 'warning'; children: ReactNode }) {
  const bg = { info: colors.sand, danger: '#FBE9E7', success: '#E7F3EC', warning: '#FFF4E0' }[tone];
  const fg = { info: colors.ink, danger: colors.danger, success: colors.success, warning: '#8A5A00' }[tone];
  return <View style={[styles.notice, { backgroundColor: bg }]} accessibilityRole={tone === 'danger' ? 'alert' : undefined}><Text style={{ color: fg, fontSize: 14, lineHeight: 20 }}>{children}</Text></View>;
}

export function Loading() {
  return <View style={styles.center}><ActivityIndicator color={colors.ink} size="large" /></View>;
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={[styles.center, { paddingVertical: space(16) }]}>
      <Text style={[type.h2, { textAlign: 'center' }]}>{title}</Text>
      {body && <Text style={[type.small, { textAlign: 'center', marginTop: 6, maxWidth: 280 }]}>{body}</Text>}
      {action && <View style={{ marginTop: space(5) }}>{action}</View>}
    </View>
  );
}

export function Badge({ children, tone = 'ink' }: { children: ReactNode; tone?: 'ink' | 'rose' | 'neutral' | 'success' }) {
  const [bg, fg] = { ink: [colors.ink, colors.paper], rose: [colors.rose, colors.ink], neutral: [colors.sand, colors.ink], success: ['#E7F3EC', colors.success] }[tone];
  return <View style={[styles.badge, { backgroundColor: bg }]}><Text style={[styles.badgeText, { color: fg }]}>{children}</Text></View>;
}

export function Price({ price, compareAt, size = 14 }: { price: string; compareAt?: string | null; size?: number }) {
  const off = percentOff(price, compareAt);
  return (
    <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
      <Text style={{ fontSize: size, fontWeight: '700', color: off ? colors.roseDeep : colors.ink }}>{money(price)}</Text>
      {!!off && <Text style={{ fontSize: size - 2, color: colors.muted, textDecorationLine: 'line-through' }} accessibilityLabel={`was ${money(compareAt!)}`}>{money(compareAt!)}</Text>}
      {!!off && <Text style={{ fontSize: size - 3, fontWeight: '700', color: colors.roseDeep }}>-{off}%</Text>}
    </View>
  );
}

export function ProductCard({ product, width }: { product: Card; width: number }) {
  const { ids, toggle } = useWishlist();
  const saved = ids.has(product.id);
  const off = percentOff(product.price, product.compareAtPrice);
  return (
    <Pressable onPress={() => router.push(`/p/${product.slug}`)} style={{ width }} accessibilityRole="link" accessibilityLabel={`${product.name}, ${money(product.price)}`}>
      <View style={{ width, height: width * 4 / 3, backgroundColor: colors.sand, borderRadius: 2, overflow: 'hidden' }}>
        {product.image && <Image source={{ uri: product.image.url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityLabel={product.image.alt} />}
        <View style={{ position: 'absolute', left: 6, top: 6, gap: 4 }}>
          {product.promotion?.type === 'FLASH_SALE' ? <Badge>⚡ -{product.promotion.percentOff}%</Badge> : off ? <Badge tone="rose">-{off}%</Badge> : null}
          {product.isNew && <Badge>New</Badge>}
          {!product.inStock && <Badge tone="neutral">Sold out</Badge>}
        </View>
        <Pressable onPress={() => toggle(product.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={saved ? `Remove ${product.name} from wishlist` : `Save ${product.name}`}
          style={styles.heart}>
          <Ionicons name={saved ? 'heart' : 'heart-outline'} size={18} color={saved ? colors.roseDeep : colors.ink} />
        </Pressable>
      </View>
      {product.brand && <Text style={[styles.brand, { marginTop: 8 }]} numberOfLines={1}>{product.brand.name}</Text>}
      <Text style={{ fontSize: 13, color: colors.ink, marginTop: 2 }} numberOfLines={2}>{product.name}</Text>
      <View style={{ marginTop: 3 }}><Price price={product.price} compareAt={product.compareAtPrice} size={13} /></View>
      {product.promotion?.stockLeft != null && product.promotion.stockLeft <= 10 && <Text style={{ fontSize: 11, fontWeight: '700', color: colors.roseDeep, marginTop: 2 }}>Only {product.promotion.stockLeft} left at this price</Text>}
    </Pressable>
  );
}

/** Two-column product grid inside a ScrollView. */
export function ProductGrid({ products, width }: { products: Card[]; width: number }) {
  const col = (width - space(4) * 2 - space(3)) / 2;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3), rowGap: space(6) }}>
      {products.map((p) => <ProductCard key={p.id} product={p} width={col} />)}
    </View>
  );
}

/** Horizontal rail of cards with a heading. */
export function Rail({ title, eyebrow, products, onMore }: { title: string; eyebrow?: string; products: Card[]; onMore?: () => void }) {
  if (!products.length) return null;
  return (
    <View style={{ marginTop: space(8) }}>
      <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: space(4), marginBottom: space(3) }]}>
        <View>{eyebrow && <Text style={type.eyebrow}>{eyebrow}</Text>}<Text style={type.h2}>{title}</Text></View>
        {onMore && <Pressable onPress={onMore} hitSlop={8}><Text style={styles.link}>View all</Text></Pressable>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space(4), gap: space(3) }}>
        {products.map((p) => <ProductCard key={p.id} product={p} width={150} />)}
      </ScrollView>
    </View>
  );
}

export function Countdown({ to, style, onDone }: { to: string; style?: object; onDone?: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, new Date(to).getTime() - now);
  useEffect(() => { if (left === 0) onDone?.(); }, [left, onDone]);
  const s = Math.floor(left / 1000);
  const d = Math.floor(s / 86400);
  const pad = (n: number) => String(n).padStart(2, '0');
  return <Text style={[{ fontVariant: ['tabular-nums'] }, style]} accessibilityRole="timer">{d > 0 ? `${d}d ` : ''}{pad(Math.floor((s % 86400) / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}</Text>;
}

export function Row({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: boolean }) {
  return (
    <View style={[styles.row, { justifyContent: 'space-between', paddingVertical: 4 }]}>
      <Text style={{ fontSize: strong ? 16 : 14, fontWeight: strong ? '800' : '400', color: accent ? colors.roseDeep : colors.ink }}>{label}</Text>
      <Text style={{ fontSize: strong ? 16 : 14, fontWeight: strong ? '800' : '500', color: accent ? colors.roseDeep : colors.ink }}>{value}</Text>
    </View>
  );
}

export function ListItem({ title, subtitle, onPress, icon, right }: { title: string; subtitle?: string; onPress?: () => void; icon?: keyof typeof Ionicons.glyphMap; right?: ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [styles.listItem, pressed && onPress && { backgroundColor: colors.sand }]}>
      {icon && <Ionicons name={icon} size={20} color={colors.ink} style={{ marginRight: space(3) }} />}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, color: colors.ink }}>{title}</Text>
        {subtitle && <Text style={type.small}>{subtitle}</Text>}
      </View>
      {right ?? (onPress && <Ionicons name="chevron-forward" size={18} color={colors.muted} />)}
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ivory },
  pad: { paddingHorizontal: space(4), paddingTop: space(4) },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(6) },
  btn: { minHeight: 50, borderRadius: 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space(5) },
  btnText: { fontSize: 13, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.ink, marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, borderRadius: 2, paddingHorizontal: space(3), fontSize: 16, color: colors.ink },
  error: { color: colors.danger, fontSize: 13, marginTop: 4 },
  notice: { padding: space(3), borderRadius: 2, marginBottom: space(4) },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  heart: { position: 'absolute', right: 6, top: 6, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', color: colors.muted },
  link: { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', textDecorationLine: 'underline', color: colors.ink },
  card: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: 2, padding: space(4) },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(4), paddingHorizontal: space(4), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, backgroundColor: colors.paper },
});
