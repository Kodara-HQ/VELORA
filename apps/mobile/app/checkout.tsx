import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GHANA_REGIONS } from '@velora/shared';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, errorMessage, randomKey } from '@/api';
import { money } from '@/format';
import { useSession } from '@/session';
import { cartKey, useCart } from '@/shop';
import { colors, space, type } from '@/theme';
import type { Address, PaymentMethodOption, PlacedOrder, Quote, ShippingOption } from '@/types';
import { Button, Empty, Field, Loading, Notice, Row, Screen, styles } from '@/ui';

const RETRY_CODES = ['PRICE_CHANGED', 'COUPON_INVALID', 'CART_ISSUES', 'INSUFFICIENT_STOCK', 'POINTS_UNAVAILABLE'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={[styles.card, { marginBottom: space(4) }]}>
      <Text style={[type.h2, { marginBottom: space(3) }]}>{title}</Text>
      {children}
    </View>
  );
}

function Choice({ selected, onPress, title, detail, right }: { selected: boolean; onPress: () => void; title: string; detail?: string; right?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected }}
      style={[styles.row, { gap: space(3), padding: space(3), borderWidth: 1, borderColor: selected ? colors.ink : colors.line, marginBottom: space(2), alignItems: 'flex-start' }]}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={colors.ink} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '600' }}>{title}</Text>
        {detail && <Text style={type.small}>{detail}</Text>}
      </View>
      {right && <Text style={{ fontWeight: '600' }}>{right}</Text>}
    </Pressable>
  );
}

export default function CheckoutScreen() {
  const qc = useQueryClient();
  const { status, user } = useSession();
  const cart = useCart();
  const signedIn = status === 'authenticated';
  const [idemKey, setIdemKey] = useState(randomKey);
  const [contact, setContact] = useState({ email: user?.email ?? '', phone: user?.phone ?? '' });
  const [addressId, setAddressId] = useState<number | 'new' | null>(null);
  const [addr, setAddr] = useState({ recipientName: user ? `${user.firstName} ${user.lastName}` : '', phone: user?.phone ?? '', line1: '', city: '', region: '' });
  const [regionPicker, setRegionPicker] = useState(false);
  const [methodId, setMethodId] = useState<number | null>(null);
  const [payMethod, setPayMethod] = useState('CASH_ON_DELIVERY');
  const [usePoints, setUsePoints] = useState(false);
  const [maxPoints, setMaxPoints] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const saved = useQuery({ queryKey: ['addresses', user?.id], queryFn: () => api<Address[]>('/me/addresses'), enabled: signedIn });
  useEffect(() => {
    if (addressId !== null) return;
    if (!signedIn) setAddressId('new');
    else if (saved.data) setAddressId(saved.data.find((a) => a.isDefault)?.id ?? saved.data[0]?.id ?? 'new');
  }, [signedIn, saved.data, addressId]);
  const savedAddr = typeof addressId === 'number' ? saved.data?.find((a) => a.id === addressId) : undefined;
  const region = savedAddr?.region ?? addr.region;

  const methods = useQuery({ queryKey: ['payment-methods'], queryFn: () => api<PaymentMethodOption[]>('/checkout/payment-methods') });
  const options = useQuery({
    queryKey: ['shipping', region, cart.data?.estimatedTotal],
    queryFn: () => api<ShippingOption[]>(`/checkout/shipping-options?region=${encodeURIComponent(region)}`),
    enabled: !!region,
  });
  useEffect(() => {
    if (options.data?.length && !options.data.some((o) => o.id === methodId)) setMethodId(options.data[0].id);
  }, [options.data, methodId]);

  const redeemPoints = usePoints && maxPoints > 0 ? maxPoints : undefined;
  const quote = useQuery({
    queryKey: ['quote', region, methodId, cart.data?.estimatedTotal, redeemPoints, contact.email],
    queryFn: () => api<Quote>('/checkout/quote', { method: 'POST', body: { region, shippingMethodId: methodId, redeemPoints, ...(!signedIn && /\S+@\S+\.\S+/.test(contact.email) && { email: contact.email }) } }),
    enabled: !!region && !!methodId,
    retry: false,
  });
  useEffect(() => { if (quote.data?.loyalty) setMaxPoints(quote.data.loyalty.maxPoints); }, [quote.data?.loyalty]);
  useEffect(() => {
    if (quote.error instanceof ApiError && quote.error.code === 'POINTS_UNAVAILABLE') { setUsePoints(false); setMaxPoints(0); }
  }, [quote.error]);

  const place = useMutation({
    mutationFn: () => {
      const phone = (p: string) => p.replace(/[\s-]/g, '');
      return api<PlacedOrder>('/checkout/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': idemKey },
        body: {
          ...(!signedIn && { contact: { email: contact.email.trim(), phone: phone(contact.phone) } }),
          ...(typeof addressId === 'number' ? { addressId } : { address: { ...addr, phone: phone(addr.phone) }, ...(signedIn && { saveAddress: true }) }),
          shippingMethodId: methodId, paymentMethod: payMethod, expectedTotal: quote.data?.grandTotal, redeemPoints,
        },
      });
    },
    onSuccess: async (order) => {
      setIdemKey(randomKey());
      void qc.invalidateQueries({ queryKey: cartKey(user?.id ?? null) });
      void qc.invalidateQueries({ queryKey: ['my-orders'] });
      qc.setQueryData(['order', order.orderNumber], order);
      // Online payment happens on the provider's secure page; we never see card or MoMo PINs.
      if (order.nextAction) await WebBrowser.openBrowserAsync(order.nextAction.url).catch(() => undefined);
      router.replace({ pathname: '/order/[number]', params: { number: order.orderNumber, ...(order.paymentError && { payError: '1' }) } });
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k.replace(/^(address|contact)\./, ''), v])));
        if (RETRY_CODES.includes(e.code)) { void qc.invalidateQueries({ queryKey: ['quote'] }); void cart.refetch(); }
      }
    },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    const phoneOk = (p: string) => /^\+233[2-5]\d{8}$/.test(p.replace(/[\s-]/g, ''));
    if (!signedIn) {
      if (!/^\S+@\S+\.\S+$/.test(contact.email.trim())) e.email = 'Enter your email';
      if (!phoneOk(contact.phone)) e.contactPhone = 'Use the format +233241234567';
    }
    if (addressId === 'new') {
      if (addr.recipientName.trim().length < 2) e.recipientName = 'Who should receive it?';
      if (!phoneOk(addr.phone)) e.phone = 'Use the format +233241234567';
      if (addr.line1.trim().length < 3) e.line1 = 'Enter the street or house address';
      if (addr.city.trim().length < 2) e.city = 'Enter the town or city';
      if (!addr.region) e.region = 'Choose a region';
    }
    setErrors(e);
    return !Object.keys(e).length;
  };

  const chosen = methods.data?.find((m) => m.code === payMethod);
  const pointsValue = quote.data?.loyalty?.points ? Number(quote.data.loyalty.value) : 0;
  const couponDiscount = useMemo(() => Number(quote.data?.discountTotal ?? 0) - pointsValue, [quote.data, pointsValue]);

  if (cart.isPending) return <Loading />;
  if (!cart.data?.items.length) return <Empty title="Your bag is empty" action={<Button title="Keep shopping" onPress={() => router.replace('/(tabs)/shop')} />} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['bottom']}>
        {!signedIn && (
          <Section title="Contact">
            <Notice>Have an account? <Text style={{ fontWeight: '700', textDecorationLine: 'underline' }} onPress={() => router.push('/login')}>Sign in</Text> to use saved addresses and earn points.</Notice>
            <Field label="Email" value={contact.email} onChangeText={(t) => setContact({ ...contact, email: t })} autoCapitalize="none" keyboardType="email-address" error={errors.email} />
            <Field label="Mobile number" value={contact.phone} onChangeText={(t) => setContact({ ...contact, phone: t })} keyboardType="phone-pad" placeholder="+233 24 123 4567" error={errors.contactPhone} hint="For delivery updates by SMS" />
          </Section>
        )}

        <Section title="Delivery address">
          {saved.data?.map((a) => (
            <Choice key={a.id} selected={addressId === a.id} onPress={() => setAddressId(a.id)} title={a.label ?? a.recipientName} detail={`${a.line1}, ${a.city}, ${a.region}`} />
          ))}
          {signedIn && !!saved.data?.length && <Choice selected={addressId === 'new'} onPress={() => setAddressId('new')} title="New address" />}
          {addressId === 'new' && (
            <View style={{ marginTop: space(2) }}>
              <Field label="Recipient name" value={addr.recipientName} onChangeText={(t) => setAddr({ ...addr, recipientName: t })} error={errors.recipientName} />
              <Field label="Recipient phone" value={addr.phone} onChangeText={(t) => setAddr({ ...addr, phone: t })} keyboardType="phone-pad" placeholder="+233 24 123 4567" error={errors.phone} />
              <Field label="Address" value={addr.line1} onChangeText={(t) => setAddr({ ...addr, line1: t })} placeholder="House number and street, or a landmark" error={errors.line1} />
              <Field label="Town / city" value={addr.city} onChangeText={(t) => setAddr({ ...addr, city: t })} error={errors.city} />
              <Text style={styles.label}>Region</Text>
              <Pressable onPress={() => setRegionPicker(true)} style={[styles.input, { justifyContent: 'center' }, errors.region ? { borderColor: colors.danger } : null]} accessibilityRole="button" accessibilityLabel={`Region: ${addr.region || 'not chosen'}`}>
                <Text style={{ fontSize: 16, color: addr.region ? colors.ink : colors.muted }}>{addr.region || 'Choose a region'}</Text>
              </Pressable>
              {errors.region && <Text style={styles.error}>{errors.region}</Text>}
            </View>
          )}
        </Section>

        {!!region && (
          <Section title="Delivery">
            {options.isPending ? <Loading /> : !options.data?.length ? <Notice tone="warning">We don’t deliver to {region} yet.</Notice> : options.data.map((o) => (
              <Choice key={o.id} selected={methodId === o.id} onPress={() => setMethodId(o.id)} title={o.name}
                detail={o.minDays === o.maxDays ? `${o.maxDays} days` : `${o.minDays}–${o.maxDays} days`} right={Number(o.fee) === 0 ? 'Free' : money(o.fee)} />
            ))}
          </Section>
        )}

        <Section title="Payment">
          {methods.isPending ? <Loading /> : methods.data?.map((m) => (
            <Choice key={m.code} selected={payMethod === m.code} onPress={() => setPayMethod(m.code)} title={m.label} detail={m.detail} />
          ))}
          {chosen?.online && <Text style={type.small}>You’ll complete payment on a secure page. Your items are held while you pay.</Text>}
        </Section>

        {signedIn && !!quote.data?.loyalty?.balance && (
          <Section title={`Rewards · ${quote.data.loyalty.balance.toLocaleString()} points`}>
            {maxPoints > 0 ? (
              <Pressable onPress={() => setUsePoints(!usePoints)} accessibilityRole="checkbox" accessibilityState={{ checked: usePoints }} style={[styles.row, { gap: space(3) }]}>
                <Ionicons name={usePoints ? 'checkbox' : 'square-outline'} size={22} color={colors.ink} />
                <Text style={{ flex: 1 }}>Use {maxPoints.toLocaleString()} points{usePoints && pointsValue ? ` to save ${money(pointsValue)}` : ''}</Text>
              </Pressable>
            ) : <Text style={type.small}>Not enough points to use on this order yet.</Text>}
          </Section>
        )}

        <Section title="Summary">
          <Row label={`Items (${cart.data.itemCount})`} value={money(quote.data?.subtotal ?? cart.data.subtotal)} />
          {couponDiscount > 0.004 && <Row label="Discount" value={`−${money(couponDiscount)}`} accent />}
          {pointsValue > 0 && <Row label={`Points (${quote.data!.loyalty!.points.toLocaleString()})`} value={`−${money(pointsValue)}`} accent />}
          <Row label="Delivery" value={quote.data ? (Number(quote.data.shippingTotal) === 0 ? 'Free' : money(quote.data.shippingTotal)) : '—'} />
          <View style={{ borderTopWidth: 1, borderTopColor: colors.line, marginTop: 6, paddingTop: 6 }}>
            <Row label="Total" value={quote.data ? money(quote.data.grandTotal) : money(cart.data.estimatedTotal)} strong />
          </View>
        </Section>

        {quote.data?.coupon && !quote.data.coupon.valid && <Notice tone="warning">Code {quote.data.coupon.code}: {quote.data.coupon.reason}</Notice>}
        {quote.isError && !(quote.error instanceof ApiError && quote.error.code === 'POINTS_UNAVAILABLE') && <Notice tone="danger">{errorMessage(quote.error)}</Notice>}
        {place.isError && <Notice tone="danger">{errorMessage(place.error)}</Notice>}
        <Button title={quote.data ? `${chosen?.online ? 'Pay' : 'Place order'} · ${money(quote.data.grandTotal)}` : 'Enter your address'}
          loading={place.isPending} disabled={!quote.data || quote.isFetching || cart.data.hasIssues}
          onPress={() => validate() && place.mutate()} />
        <Text style={[type.small, { textAlign: 'center', marginTop: space(3) }]}>By placing your order you agree to VÉLORA’s terms of sale and 14-day returns policy.</Text>
      </Screen>

      <Modal visible={regionPicker} animationType="slide" transparent onRequestClose={() => setRegionPicker(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} onPress={() => setRegionPicker(false)} accessibilityLabel="Close" />
        <View style={{ maxHeight: '70%', backgroundColor: colors.paper }}>
          <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: space(10) }}>
            <Text style={[type.h2, { marginBottom: space(2) }]}>Region</Text>
            {GHANA_REGIONS.map((r) => (
              <Pressable key={r} onPress={() => { setAddr({ ...addr, region: r }); setRegionPicker(false); }} style={[styles.row, { justifyContent: 'space-between', paddingVertical: space(3) }]}>
                <Text style={{ fontSize: 16, fontWeight: addr.region === r ? '700' : '400' }}>{r}</Text>
                {addr.region === r && <Ionicons name="checkmark" size={20} color={colors.ink} />}
              </Pressable>
            ))}
          </ScrollView>
        </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
