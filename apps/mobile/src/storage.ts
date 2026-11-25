import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Secrets (the refresh token) live in the device keychain / keystore.
 * Expo web has no keychain, so it falls back to localStorage — development use only.
 */
export const secure = {
  async get(key: string) {
    if (Platform.OS === 'web') { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string) {
    if (Platform.OS === 'web') { try { globalThis.localStorage?.setItem(key, value); } catch { /* private mode */ } return; }
    await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
  },
  async remove(key: string) {
    if (Platform.OS === 'web') { try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ } return; }
    await SecureStore.deleteItemAsync(key);
  },
};
