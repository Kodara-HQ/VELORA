import type { AuthUser, PaginationMeta } from '@velora/shared';
import { secure } from './storage';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
const REFRESH_KEY = 'velora.refresh';
const GUEST_KEY = 'velora.guest';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
  /** Validation errors as { field: message } for forms. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as Array<{ field: string; messages: string[] }>).map((d) => [d.field, d.messages[0]]));
  }
}

export const errorMessage = (e: unknown) =>
  e instanceof ApiError ? e.message : e instanceof TypeError ? 'Can’t reach VÉLORA. Check your connection and try again.' : 'Something went wrong. Please try again.';

// ─── Tokens ───
// The access token is kept only in memory; the refresh token in the keychain.
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let guestId: string | null = null;
let onSignedOut: (() => void) | null = null;

export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };

export interface SessionPayload { user: AuthUser; tokens: { accessToken: string; expiresIn: number; refreshToken?: string } }

export async function storeSession(s: SessionPayload) {
  accessToken = s.tokens.accessToken;
  if (s.tokens.refreshToken) await secure.set(REFRESH_KEY, s.tokens.refreshToken);
}

export async function clearSession() {
  accessToken = null;
  await secure.remove(REFRESH_KEY);
}

export async function storedRefreshToken() {
  return secure.get(REFRESH_KEY);
}

/** Anonymous shoppers get a random id so their bag survives app restarts (merged into the account on sign-in). */
export async function getGuestId() {
  if (guestId) return guestId;
  guestId = await secure.get(GUEST_KEY);
  if (!guestId) {
    const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    guestId = `g_${bytes}`;
    await secure.set(GUEST_KEY, guestId);
  }
  return guestId;
}

/** Single-flight refresh: concurrent 401s share one rotation (reusing a rotated token would revoke the session). */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const token = await secure.get(REFRESH_KEY);
    if (!token) return false;
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Velora-Client': 'mobile' },
        body: JSON.stringify({ refreshToken: token }),
      });
      if (!res.ok) {
        if (res.status === 401) { await clearSession(); onSignedOut?.(); }
        return false;
      }
      const body = (await res.json()) as { data: SessionPayload };
      await storeSession(body.data);
      return true;
    } catch {
      return false; // offline: keep the stored token and try again later
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

interface RequestOptions { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; headers?: Record<string, string>; auth?: boolean }

async function raw<T>(path: string, opts: RequestOptions, retried = false): Promise<{ data: T; meta?: PaginationMeta }> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Velora-Client': 'mobile', 'X-Guest-Id': await getGuestId(), ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${API_URL}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && opts.auth !== false && !retried && (await refreshSession())) return raw<T>(path, opts, true);
  const json = (await res.json().catch(() => null)) as { success: boolean; data: T; meta?: PaginationMeta; error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok || !json?.success) {
    throw new ApiError(res.status, json?.error?.code ?? 'HTTP_' + res.status, json?.error?.message ?? `Request failed (${res.status})`, json?.error?.details);
  }
  return { data: json.data, meta: json.meta };
}

export const api = async <T>(path: string, opts: RequestOptions = {}) => (await raw<T>(path, opts)).data;
export const apiWithMeta = <T>(path: string, opts: RequestOptions = {}) => raw<T>(path, opts);

export const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const randomKey = () => Array.from({ length: 32 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
