import type { AuthUser } from '@velora/shared';
import { create } from 'zustand';
import { api, clearSession, refreshSession, setSignedOutHandler, storedRefreshToken, storeSession, type SessionPayload } from './api';
import { registerForPush, unregisterPush } from './push';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface SessionState {
  status: Status;
  user: AuthUser | null;
  bootstrap: () => Promise<void>;
  signIn: (s: SessionPayload) => Promise<void>;
  signOut: () => Promise<void>;
  reloadUser: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,

  /** On launch: if a refresh token is stored, rotate it and load the user. */
  async bootstrap() {
    if (!(await storedRefreshToken()) || !(await refreshSession())) {
      set({ status: 'anonymous', user: null });
      return;
    }
    try {
      const user = await api<AuthUser>('/auth/me');
      set({ status: 'authenticated', user });
      void registerForPush();
    } catch {
      set({ status: 'anonymous', user: null });
    }
  },

  async signIn(s) {
    await storeSession(s);
    set({ status: 'authenticated', user: s.user });
    void registerForPush();
  },

  async signOut() {
    // Stop pushes to this phone first (needs the session), then revoke the session.
    await unregisterPush().catch(() => undefined);
    const refreshToken = await storedRefreshToken();
    await api('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
    await clearSession();
    set({ status: 'anonymous', user: null });
  },

  async reloadUser() {
    if (get().status !== 'authenticated') return;
    set({ user: await api<AuthUser>('/auth/me') });
  },
}));

// A refresh that fails with 401 (revoked or expired session) signs the app out everywhere.
setSignedOutHandler(() => useSession.setState({ status: 'anonymous', user: null }));
