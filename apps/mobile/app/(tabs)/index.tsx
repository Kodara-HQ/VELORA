import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api, errorMessage } from '@/api';
import { useSession } from '@/session';
import { colors, space, type } from '@/theme';
import type { HomeFeed, LiveSale, ProductCard as Card } from '@/types';
import { Button, Countdown, Loading, Notice, ProductCard, Rail, styles } from '@/ui';

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const status = useSession((s) => s.status);
  const home = useQuery({ queryKey: ['home'], queryFn: () => api<HomeFeed>('/storefront/home', { auth: false }) });
  const sales = useQuery({ queryKey: ['sales-live'], queryFn: () => api<LiveSale[]>('/promotions/live', { auth: false }) });
  const picks = useQuery({ queryKey: ['recommendations', status], queryFn: () => api<Card[]>('/recommendations') });
  const live = sales.data?.find((s) => s.state === 'LIVE' && s.products.length);
  const refresh = () => { void home.refetch(); void sales.refetch(); void picks.refetch(); };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={{ paddingHorizontal: space(4), paddingVertical: space(3), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 20, fontWeight: '800', letterSpacing: 6, color: colors.ink }}>VÉLORA</Text>
        <Pressable onPress={() => router.push('/account/notifications')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Notifications">
          <Ionicons name="notifications-outline" size={22} color={colors.ink} />
        </Pressable>
      </View>
      <Pressable onPress={() => router.push('/(tabs)/shop')} style={{ marginHorizontal: space(4), height: 44, borderRadius: 22, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(4), gap: 8 }}
        accessibilityRole="search" accessibilityLabel="Search VÉLORA">
        <Ionicons name="search" size={18} color={colors.muted} />
        <Text style={{ color: colors.muted, fontSize: 15 }}>Search dresses, kente, sneakers…</Text>
      </Pressable>
      {home.isPending ? <Loading /> : home.isError ? (
        <View style={{ padding: space(4) }}><Notice tone="danger">{errorMessage(home.error)}</Notice><Button title="Try again" variant="secondary" onPress={refresh} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: space(12) }}>
          <View style={{ margin: space(4), padding: space(6), backgroundColor: colors.rose, borderRadius: 2 }}>
            <Text style={[type.eyebrow, { color: colors.ink }]}>The new season edit</Text>
            <Text style={{ fontSize: 40, lineHeight: 40, fontWeight: '800', color: colors.ink, marginTop: 8 }}>DEFINE{'\n'}YOUR STYLE.</Text>
            <Button title="Shop new in" style={{ marginTop: space(5), alignSelf: 'flex-start' }} onPress={() => router.push('/search?sort=newest')} />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space(4), gap: space(2) }}>
            {home.data.categories.map((c) => (
              <Pressable key={c.slug} onPress={() => router.push(`/c/${c.slug}`)} style={{ paddingHorizontal: space(4), paddingVertical: space(2), borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper }}>
                <Text style={{ fontSize: 13, fontWeight: '600' }}>{c.name.replace(/'s Fashion$/, "'s").replace(' & Lifestyle', '')}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {live && (
            <View style={{ marginTop: space(6), backgroundColor: colors.ink, paddingVertical: space(5) }}>
              <Pressable onPress={() => router.push(`/sale/${live.slug}`)} style={{ paddingHorizontal: space(4), marginBottom: space(4) }}>
                <Text style={[type.eyebrow, { color: colors.rose }]}>{live.type === 'FLASH_SALE' ? 'Flash sale' : 'Sale'} · ends in</Text>
                <Countdown to={live.endsAt} onDone={() => void sales.refetch()} style={{ fontSize: 34, fontWeight: '800', color: colors.paper, marginTop: 4 }} />
                <Text style={{ color: colors.paper, fontSize: 17, fontWeight: '800', marginTop: 4 }}>{live.name} ›</Text>
                {live.headline && <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>{live.headline}</Text>}
              </Pressable>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space(4), gap: space(3) }}>
                {live.products.map((p) => (
                  <View key={p.id} style={{ backgroundColor: colors.paper, padding: 6, borderRadius: 2 }}><ProductCard product={p} width={140} /></View>
                ))}
              </ScrollView>
            </View>
          )}

          <Rail eyebrow="Just landed" title="New arrivals" products={home.data.newArrivals} onMore={() => router.push('/search?sort=newest')} />
          <Rail eyebrow="For you" title="Picked for you" products={picks.data ?? []} />
          <Rail eyebrow="Most loved" title="Best sellers" products={home.data.bestSellers} onMore={() => router.push('/search?sort=popular')} />
          <Rail eyebrow="Limited time" title="On sale" products={home.data.onSale} onMore={() => router.push('/search?onSale=true')} />
          <View style={{ margin: space(4), marginTop: space(10), padding: space(6), backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, width: width - space(8) }}>
            <Text style={type.h2}>Pay on delivery, anywhere in Ghana</Text>
            <Text style={[type.small, { marginTop: 6 }]}>Cash or MoMo to the rider, or pay online. 14-day returns and size exchanges.</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
