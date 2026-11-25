import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '@/api';
import { useSession } from '@/session';
import { colors } from '@/theme';
import { Loading } from '@/ui';

/** Links inside notifications use the website's paths; the app's routes mirror them. */
function openHref(href: unknown) {
  if (typeof href === 'string' && href.startsWith('/')) router.push(href as never);
}

export default function RootLayout() {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, staleTime: 30_000 },
    },
  }));
  const status = useSession((s) => s.status);

  useEffect(() => { void useSession.getState().bootstrap(); }, []);

  // Refresh what's on screen when the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void client.invalidateQueries(); });
    return () => sub.remove();
  }, [client]);

  // Tapping a push notification opens the related screen (also when it launched the app).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const last = Notifications.getLastNotificationResponse();
    if (last) openHref(last.notification.request.content.data?.href);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => openHref(r.notification.request.content.data?.href));
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <StatusBar style="dark" />
        {status === 'loading' ? <Loading /> : (
          <Stack screenOptions={{
            headerTintColor: colors.ink, headerStyle: { backgroundColor: colors.ivory }, headerShadowVisible: false,
            headerTitleStyle: { fontWeight: '800' }, contentStyle: { backgroundColor: colors.ivory }, headerBackTitle: 'Back',
          }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ title: 'Sign in', presentation: 'modal' }} />
            <Stack.Screen name="register" options={{ title: 'Create account', presentation: 'modal' }} />
            <Stack.Screen name="p/[slug]" options={{ title: '' }} />
            <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
          </Stack>
        )}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
