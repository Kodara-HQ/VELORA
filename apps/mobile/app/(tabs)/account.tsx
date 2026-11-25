import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Alert, Text, View } from 'react-native';
import { api } from '@/api';
import { useSession } from '@/session';
import { colors, space, type } from '@/theme';
import type { LoyaltySummary } from '@/types';
import { Button, ListItem, Screen } from '@/ui';

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3000';

export default function AccountScreen() {
  const { status, user, signOut } = useSession();
  const loyalty = useQuery({ queryKey: ['my-loyalty'], queryFn: () => api<LoyaltySummary>('/me/loyalty'), enabled: status === 'authenticated' });
  const unread = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api<{ count: number }>('/me/notifications/unread-count'), enabled: status === 'authenticated' });

  if (status !== 'authenticated' || !user) {
    return (
      <Screen>
        <Text style={type.eyebrow}>VÉLORA members</Text>
        <Text style={[type.display, { marginTop: 4 }]}>Define your style.</Text>
        <Text style={[type.body, { color: colors.muted, marginTop: space(2), marginBottom: space(6) }]}>Earn points on every order, track deliveries and save your favourites.</Text>
        <Button title="Sign in" onPress={() => router.push('/login')} />
        <Button title="Create account" variant="secondary" style={{ marginTop: space(3) }} onPress={() => router.push('/register')} />
        <View style={{ marginTop: space(8), marginHorizontal: -space(4) }}>
          <ListItem icon="help-circle-outline" title="Help & returns" onPress={() => WebBrowser.openBrowserAsync(`${WEB_URL}/track-order`)} />
        </View>
      </Screen>
    );
  }

  const l = loyalty.data;
  return (
    <Screen refreshing={loyalty.isRefetching} onRefresh={() => { void loyalty.refetch(); void unread.refetch(); }}>
      <Text style={type.eyebrow}>My account</Text>
      <Text style={[type.display, { marginTop: 4 }]}>Hello, {user.firstName}.</Text>
      <View style={{ backgroundColor: colors.ink, padding: space(5), marginTop: space(5) }}>
        <Text style={{ color: colors.rose, fontSize: 11, fontWeight: '700', letterSpacing: 2 }}>VÉLORA REWARDS · {l?.tier ?? '—'}</Text>
        <Text style={{ color: colors.paper, fontSize: 34, fontWeight: '800', marginTop: 4 }}>{(l?.pointsBalance ?? 0).toLocaleString()} <Text style={{ fontSize: 15, fontWeight: '500' }}>points</Text></Text>
        {l?.nextTier && <Text style={{ color: 'rgba(255,255,255,0.75)', marginTop: 4 }}>{l.nextTier.pointsNeeded.toLocaleString()} to {l.nextTier.tier.toLowerCase()}</Text>}
      </View>
      <View style={{ marginTop: space(5), marginHorizontal: -space(4) }}>
        <ListItem icon="receipt-outline" title="Orders" subtitle="Track, cancel and pay" onPress={() => router.push('/account/orders')} />
        <ListItem icon="gift-outline" title="Rewards" subtitle="Points history and referrals" onPress={() => router.push('/account/loyalty')} />
        <ListItem icon="notifications-outline" title="Notifications" subtitle={unread.data?.count ? `${unread.data.count} unread` : 'Messages and preferences'} onPress={() => router.push('/account/notifications')} />
        <ListItem icon="heart-outline" title="Wishlist" onPress={() => router.push('/(tabs)/wishlist')} />
        <ListItem icon="return-down-back-outline" title="Returns & reviews" subtitle="Manage on the website" onPress={() => WebBrowser.openBrowserAsync(`${WEB_URL}/account/returns`)} />
      </View>
      <Button title="Sign out" variant="ghost" style={{ marginTop: space(6) }}
        onPress={() => Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void signOut() }])} />
      <Text style={[type.small, { textAlign: 'center' }]}>{user.email}</Text>
    </Screen>
  );
}
