import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Pressable, Switch, Text, View } from 'react-native';
import { api, errorMessage } from '@/api';
import { timeAgo } from '@/format';
import { registerForPush } from '@/push';
import { useSession } from '@/session';
import { colors, space, type } from '@/theme';
import type { AppNotification } from '@/types';
import { Button, Empty, Loading, Notice, Screen, styles } from '@/ui';

type Channel = { orders: boolean; marketing: boolean };
interface Prefs { email: Channel; sms: Channel; push: Channel }

export default function NotificationsScreen() {
  const qc = useQueryClient();
  const status = useSession((s) => s.status);
  const list = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => api<AppNotification[]>('/me/notifications?pageSize=40'), enabled: status === 'authenticated' });
  const prefs = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api<Prefs>('/me/notification-preferences'), enabled: status === 'authenticated' });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: (id: number) => api(`/me/notifications/${id}/read`, { method: 'POST', body: {} }), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api('/me/notifications/read-all', { method: 'POST', body: {} }), onSuccess: refresh });
  const save = useMutation({
    mutationFn: (p: Prefs) => api<Prefs>('/me/notification-preferences', { method: 'PUT', body: p }),
    onMutate: (p) => qc.setQueryData(['notification-prefs'], p),
    onSuccess: (p) => { qc.setQueryData(['notification-prefs'], p); if (p.push.orders || p.push.marketing) void registerForPush(); },
  });

  if (status !== 'authenticated') {
    return <Screen edges={[]}><Stack.Screen options={{ title: 'Notifications' }} /><Empty title="Sign in to see notifications" action={<Button title="Sign in" onPress={() => router.push('/login')} />} /></Screen>;
  }
  const p = prefs.data;
  const toggle = (ch: keyof Prefs, k: keyof Channel) => p && save.mutate({ ...p, [ch]: { ...p[ch], [k]: !p[ch][k] } });

  return (
    <Screen edges={[]} refreshing={list.isRefetching} onRefresh={() => list.refetch()}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      {list.isPending ? <Loading /> : list.isError ? <Notice tone="danger">{errorMessage(list.error)}</Notice> : !list.data.length ? (
        <Text style={[type.small, { marginBottom: space(4) }]}>Nothing yet. Order updates and rewards will appear here.</Text>
      ) : (
        <View style={{ marginHorizontal: -space(4) }}>
          {list.data.some((n) => !n.readAt) && <Pressable onPress={() => readAll.mutate()} style={{ alignSelf: 'flex-end', paddingHorizontal: space(4), paddingBottom: space(2) }}><Text style={styles.link}>Mark all read</Text></Pressable>}
          {list.data.map((n) => (
            <Pressable key={n.id} onPress={() => { if (!n.readAt) read.mutate(n.id); if (n.data?.href) router.push(n.data.href as never); }}
              style={{ flexDirection: 'row', gap: space(3), padding: space(4), backgroundColor: n.readAt ? colors.paper : colors.ivory, borderBottomWidth: 1, borderBottomColor: colors.line }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: n.readAt ? 'transparent' : colors.roseDeep }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: n.readAt ? '400' : '700' }}>{n.title}</Text>
                <Text style={type.small}>{n.body}</Text>
                <Text style={[type.small, { fontSize: 11, marginTop: 2 }]}>{timeAgo(n.createdAt)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={[type.h2, { marginTop: space(8) }]}>How we contact you</Text>
      <Text style={[type.small, { marginBottom: space(3) }]}>Choose what reaches you outside the app.</Text>
      {save.isError && <Notice tone="danger">{errorMessage(save.error)}</Notice>}
      {p && (
        <View style={styles.card}>
          {([['push', 'App notifications'], ['email', 'Email'], ['sms', 'SMS']] as const).map(([ch, label]) => (
            <View key={ch} style={{ paddingVertical: space(2), borderBottomWidth: ch === 'sms' ? 0 : 1, borderBottomColor: colors.line }}>
              <Text style={{ fontWeight: '700', marginBottom: 4 }}>{label}</Text>
              {([['orders', 'Order updates'], ['marketing', 'Offers and new arrivals']] as const).map(([k, l]) => (
                <View key={k} style={[styles.row, { justifyContent: 'space-between', paddingVertical: 4 }]}>
                  <Text>{l}</Text>
                  <Switch value={p[ch][k]} onValueChange={() => toggle(ch, k)} trackColor={{ true: colors.ink, false: colors.line }} thumbColor={colors.paper} accessibilityLabel={`${l} by ${label}`} />
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
