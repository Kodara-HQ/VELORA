import { create } from 'zustand';
import type { AuthTokens, AuthUser, Permission } from '@velora/shared';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface SessionState {
  status: Status;
  user: AuthUser | null;
  /** Kept in memory only — never in localStorage — so XSS can't lift a long-lived credential. */
  accessToken: string | null;
  signIn: (payload: { user: AuthUser; tokens: AuthTokens }) => void;
  signOutLocal: () => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  signIn: ({ user, tokens }) => set({ status: 'authenticated', user, accessToken: tokens.accessToken }),
  signOutLocal: () => set({ status: 'anonymous', user: null, accessToken: null }),
}));

/** UI-only check for showing or hiding controls. The API enforces every permission itself. */
export function useCan(...perms: Permission[]) {
  const user = useSession((s) => s.user);
  return !!user && perms.every((p) => user.permissions.includes(p));
}
