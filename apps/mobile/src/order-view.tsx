import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Text, View } from 'react-native';
import { api, errorMessage } from './api';
import { humanize, money, shortDate } from './format';
import { useSession } from './session';
import { colors, space, type } from './theme';
import type { Order, PaymentMethodOption } from './types';
import { Badge, Button, Empty, Loading, Notice, Row, Screen, styles } from './ui';

/** Order detail for the confirmation screen and the account's order history (and push deep links). */
export function OrderView({ number, justPlaced, payError }: { number: string; justPlaced?: boolean; payError?: boolean }) {
  const qc = useQueryClient();
  const status = useSession((s) => s.status);
  const cached = qc.getQueryData<Order>(['order', number]);
  const q = useQuery({
    queryKey: ['order', number],
    queryFn: () => api<Order>(`/me/orders/${number}`),
    enabled: status === 'authenticated',
    initialData: cached,
    refetchInterval: (query) => (query.state.data?.status === 'PENDING_PAYMENT' ? 5000 : false),
  });
  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api<PaymentMethodOption[]>('/checkout/payment-methods') });
  const cancel = useMutation({
    mutationFn: () => api<Order>(`/me/orders/${number}/cancel`, { method: 'POST', body: {} }),
    onSuccess: (o) => { qc.setQueryData(['order', number], o); void qc.invalidateQueries({ queryKey: ['my-orders'] }); },
  });
  const pay = useMutation({
    mutationFn: (provider: string) => api<{ nextAction: { url: string } }>(`/orders/${number}/pay`, { method: 'POST', body: { provider } }),
    onSuccess: async (r) => { await WebBrowser.openBrowserAsync(r.nextAction.url).catch(() => undefined); void q.refetch(); },
  });

  const o = q.data;
  if (!o && q.isPending) return <Loading />;
  if (!o) {
    return <Screen><Empty title={`Order ${number}`} body={status === 'authenticated' ? errorMessage(q.error) : 'Sign in, or track this order with your email on velora.com.gh.'} action={<Button title="Sign in" onPress={() => router.push('/login')} />} /></Screen>;
  }
  const online = methods.data?.filter((m) => m.online) ?? [];

  return (
    <Screen edges={[]} refreshing={q.isRefetching} onRefresh={status === 'authenticated' ? () => q.refetch() : undefined}>
      {justPlaced && (
        <View style={{ alignItems: 'center', marginBottom: space(5) }}>
          <Text style={type.eyebrow}>{o.status === 'PENDING_PAYMENT' ? 'Almost there' : 'Thank you'}</Text>
          <Text style={[type.display, { textAlign: 'center' }]}>{o.status === 'PENDING_PAYMENT' ? 'Complete your payment' : 'Order confirmed'}</Text>
          <Text style={[type.small, { textAlign: 'center' }]}>We’ve sent the details to you. Order {o.orderNumber}.</Text>
        </View>
      )}
      {payError && <Notice tone="warning">We couldn’t open the payment page. Your items are held: try paying again below.</Notice>}

      <View style={[styles.row, { justifyContent: 'space-between', marginBottom: space(3) }]}>
        <Text style={type.h2}>{o.orderNumber}</Text>
        <Badge tone={o.status === 'DELIVERED' || o.status === 'COMPLETED' ? 'success' : o.status === 'CANCELLED' ? 'neutral' : 'ink'}>{humanize(o.status)}</Badge>
      </View>
      <Text style={type.small}>Placed {shortDate(o.placedAt)}{o.estimatedDelivery ? ` · arrives ${shortDate(o.estimatedDelivery.from)}–${shortDate(o.estimatedDelivery.to)}` : ''}</Text>

      {o.status === 'PENDING_PAYMENT' && o.canPay && (
        <View style={[styles.card, { marginTop: space(4), gap: space(2) }]}>
          <Text style={{ fontWeight: '700' }}>Payment pending</Text>
          <Text style={type.small}>Your items are held{o.paymentDueAt ? ` until ${new Date(o.paymentDueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}. This page updates once payment is confirmed.</Text>
          {pay.isError && <Notice tone="danger">{errorMessage(pay.error)}</Notice>}
          {online.map((m) => <Button key={m.code} title={`Pay with ${m.label}`} variant="secondary" loading={pay.isPending && pay.variables === m.code} onPress={() => pay.mutate(m.code)} />)}
        </View>
      )}

      <View style={[styles.card, { marginTop: space(4) }]}>
        {o.items.map((i, n) => (
          <View key={n} style={[styles.row, { gap: space(3), paddingVertical: space(2) }]}>
            <View style={{ width: 54, height: 72, backgroundColor: colors.sand }}>{i.image && <Image source={{ uri: i.image }} style={{ flex: 1 }} contentFit="cover" />}</View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600' }} numberOfLines={2}>{i.name}</Text>
              <Text style={type.small}>{i.variantLabel} · ×{i.quantity}</Text>
            </View>
            <Text style={{ fontWeight: '600' }}>{money(i.lineTotal)}</Text>
          </View>
        ))}
        <View style={{ borderTopWidth: 1, borderTopColor: colors.line, marginTop: space(2), paddingTop: space(2) }}>
          <Row label="Subtotal" value={money(o.subtotal)} />
          {Number(o.discountTotal) - Number(o.loyaltyDiscount) > 0.004 && <Row label="Discount" value={`−${money(Number(o.discountTotal) - Number(o.loyaltyDiscount))}`} accent />}
          {o.loyaltyPointsUsed > 0 && <Row label={`Points (${o.loyaltyPointsUsed.toLocaleString()})`} value={`−${money(o.loyaltyDiscount)}`} accent />}
          <Row label="Delivery" value={Number(o.shippingTotal) === 0 ? 'Free' : money(o.shippingTotal)} />
          <Row label="Total" value={money(o.grandTotal)} strong />
        </View>
      </View>

      <View style={[styles.card, { marginTop: space(4) }]}>
        <Text style={{ fontWeight: '700', marginBottom: 4 }}>Delivering to</Text>
        <Text>{o.shippingAddress.recipientName} · {o.shippingAddress.phone}</Text>
        <Text style={type.small}>{o.shippingAddress.line1}, {o.shippingAddress.city}, {o.shippingAddress.region}</Text>
        {o.payment && <Text style={[type.small, { marginTop: space(2) }]}>Payment: {humanize(o.payment.method)} · {humanize(o.payment.status)}</Text>}
      </View>

      <View style={[styles.card, { marginTop: space(4) }]}>
        <Text style={{ fontWeight: '700', marginBottom: space(2) }}>Progress</Text>
        {o.history.map((h, n) => (
          <View key={n} style={{ flexDirection: 'row', gap: space(3), paddingBottom: space(3) }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: n === o.history.length - 1 ? colors.ink : colors.line }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600' }}>{humanize(h.status)}</Text>
              {h.note && <Text style={type.small}>{h.note}</Text>}
              <Text style={type.small}>{new Date(h.at).toLocaleString()}</Text>
            </View>
          </View>
        ))}
      </View>

      {cancel.isError && <View style={{ marginTop: space(3) }}><Notice tone="danger">{errorMessage(cancel.error)}</Notice></View>}
      {o.canCancel && status === 'authenticated' && (
        <Button title="Cancel order" variant="danger" style={{ marginTop: space(4) }} loading={cancel.isPending}
          onPress={() => Alert.alert('Cancel this order?', 'Your items will be released. Any payment made will be refunded.', [
            { text: 'Keep order', style: 'cancel' },
            { text: 'Cancel order', style: 'destructive', onPress: () => cancel.mutate() },
          ])} />
      )}
      {justPlaced && <Button title="Continue shopping" variant="secondary" style={{ marginTop: space(3) }} onPress={() => router.replace('/(tabs)')} />}
    </Screen>
  );
}
