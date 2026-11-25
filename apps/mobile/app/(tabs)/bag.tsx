import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { errorMessage } from '@/api';
import { money } from '@/format';
import { useCart, useCartMutations } from '@/shop';
import { colors, space, type } from '@/theme';
import type { CartLine } from '@/types';
import { Button, Empty, Loading, Notice, Row, Screen, styles } from '@/ui';

const ISSUE: Record<string, string> = { UNAVAILABLE: 'No longer available', OUT_OF_STOCK: 'Sold out', INSUFFICIENT_STOCK: 'Not enough in stock' };

function Line({ l }: { l: CartLine }) {
  const { update, remove } = useCartMutations();
  const busy = update.isPending || remove.isPending;
  return (
    <View style={{ flexDirection: 'row', gap: space(3), paddingVertical: space(4), borderBottomWidth: 1, borderBottomColor: colors.line, opacity: busy ? 0.6 : 1 }}>
      <Pressable onPress={() => router.push(`/p/${l.slug}`)}>
        <View style={{ width: 84, height: 112, backgroundColor: colors.sand }}>{l.image && <Image source={{ uri: l.image }} style={{ flex: 1 }} contentFit="cover" />}</View>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600' }} numberOfLines={2}>{l.name}</Text>
        <Text style={type.small}>{l.variantLabel}</Text>
        {l.promotion && <Text style={{ fontSize: 12, color: colors.roseDeep, fontWeight: '700' }}>{l.promotion.name} price</Text>}
        {l.issue && <Text style={{ fontSize: 12, color: colors.danger, fontWeight: '700', marginTop: 2 }}>{ISSUE[l.issue]}{l.issue === 'INSUFFICIENT_STOCK' ? ` (${l.available} left)` : ''}</Text>}
        <View style={[styles.row, { justifyContent: 'space-between', marginTop: 'auto' }]}>
          <View style={[styles.row, { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper }]}>
            <Pressable onPress={() => (l.quantity > 1 ? update.mutate({ id: l.id, quantity: l.quantity - 1 }) : remove.mutate(l.id))} disabled={busy} style={{ padding: 8 }} accessibilityLabel="Decrease quantity">
              <Ionicons name={l.quantity > 1 ? 'remove' : 'trash-outline'} size={16} color={colors.ink} />
            </Pressable>
            <Text style={{ minWidth: 24, textAlign: 'center', fontWeight: '600' }} accessibilityLabel={`Quantity ${l.quantity}`}>{l.quantity}</Text>
            <Pressable onPress={() => update.mutate({ id: l.id, quantity: l.quantity + 1 })} disabled={busy || l.quantity >= l.available} style={{ padding: 8, opacity: l.quantity >= l.available ? 0.3 : 1 }} accessibilityLabel="Increase quantity">
              <Ionicons name="add" size={16} color={colors.ink} />
            </Pressable>
          </View>
          <Text style={{ fontWeight: '700' }}>{money(l.lineTotal)}</Text>
        </View>
      </View>
    </View>
  );
}

export default function BagScreen() {
  const cart = useCart();
  const { applyCoupon, removeCoupon } = useCartMutations();
  const [code, setCode] = useState('');
  const c = cart.data;

  return (
    <Screen refreshing={cart.isRefetching} onRefresh={() => cart.refetch()}>
      <Text style={type.display}>Your bag</Text>
      {cart.isPending ? <Loading /> : cart.isError ? <Notice tone="danger">{errorMessage(cart.error)}</Notice> : !c?.items.length ? (
        <Empty title="Your bag is empty" body="Pieces you add will wait here for you." action={<Button title="Start shopping" onPress={() => router.push('/(tabs)/shop')} />} />
      ) : (
        <View>
          {c.notice && <Notice>{c.notice}</Notice>}
          {c.items.map((l) => <Line key={l.id} l={l} />)}

          <View style={{ marginTop: space(5) }}>
            {c.coupon ? (
              <View style={[styles.row, { justifyContent: 'space-between', backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, padding: space(3) }]}>
                <Text style={{ fontWeight: '700' }}>{c.coupon.code} <Text style={{ fontWeight: '400', color: c.coupon.valid ? colors.success : colors.danger }}>{c.coupon.valid ? `−${money(c.coupon.discount)}` : c.coupon.reason}</Text></Text>
                <Pressable onPress={() => removeCoupon.mutate()} hitSlop={8}><Text style={styles.link}>Remove</Text></Pressable>
              </View>
            ) : (
              <View style={[styles.row, { gap: space(2) }]}>
                <TextInput value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="Promo code" autoCapitalize="characters" placeholderTextColor={colors.muted}
                  style={[styles.input, { flex: 1 }]} accessibilityLabel="Promo code" />
                <Button title="Apply" variant="secondary" disabled={code.length < 3} loading={applyCoupon.isPending} onPress={() => applyCoupon.mutate(code, { onSuccess: () => setCode('') })} />
              </View>
            )}
            {applyCoupon.isError && <Text style={styles.error}>{errorMessage(applyCoupon.error)}</Text>}
          </View>

          <View style={[styles.card, { marginTop: space(5) }]}>
            <Row label="Subtotal" value={money(c.subtotal)} />
            {Number(c.discountTotal) > 0 && <Row label="Discount" value={`−${money(c.discountTotal)}`} accent />}
            <Row label="Delivery" value="At checkout" />
            <View style={{ borderTopWidth: 1, borderTopColor: colors.line, marginTop: 6, paddingTop: 6 }}><Row label="Estimated total" value={money(c.estimatedTotal)} strong /></View>
          </View>
          {c.hasIssues && <View style={{ marginTop: space(3) }}><Notice tone="warning">Some items need your attention before checkout.</Notice></View>}
          <Button title="Checkout" style={{ marginTop: space(4) }} disabled={c.hasIssues} onPress={() => router.push('/checkout')} />
        </View>
      )}
    </Screen>
  );
}
