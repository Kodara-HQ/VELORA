import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

let currentToken: string | null = null;

// Show notifications while the app is open too (as a banner), like most shopping apps.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/**
 * Asks for permission (once) and registers this device's Expo push token with the API.
 * Needs a physical device and an EAS project id (app.json → extra.eas.projectId); otherwise it quietly does nothing.
 */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId || Constants.easConfig?.projectId;
  if (!projectId) {
    if (__DEV__) console.info('[push] No EAS projectId configured; skipping push registration.');
    return null;
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Order updates', importance: Notifications.AndroidImportance.HIGH, lightColor: '#D9A0A7' });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api('/me/push-tokens', { method: 'POST', body: { token, platform: Platform.OS } });
  currentToken = token;
  return token;
}

export async function unregisterPush() {
  if (!currentToken) return;
  await api('/me/push-tokens/remove', { method: 'POST', body: { token: currentToken, platform: Platform.OS } });
  currentToken = null;
}
