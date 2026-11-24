import type { ApiResponse, AuthTokens, AuthUser, PaginationMeta } from '@velora/shared';
import { useSession } from './session';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: Method;
  body?: unknown;
  /** Attach the access token (default true). */
  auth?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const GUEST_KEY = 'velora_gid';
let guestId: string | null = null;

/** Random id for this browser so guests keep a bag and browsing history. Not a credential. */
export function getGuestId(): string | null {
  if (typeof window === 'undefined') return null;
  if (guestId) return guestId;
  try {
    guestId = localStorage.getItem(GUEST_KEY);
    if (!guestId || !/^[A-Za-z0-9_-]{16,64}$/.test(guestId)) {
      guestId = `g_${crypto.randomUUID().replace(/-/g, '')}`;
      localStorage.setItem(GUEST_KEY, guestId);
    }
  } catch {
    guestId ??= `g_${crypto.randomUUID().replace(/-/g, '')}`; // storage blocked: keep for this page view
  }
  return guestId;
}

async function raw<T>(path: string, opts: RequestOptions, token: string | null): Promise<{ data: T; meta?: PaginationMeta }> {
  const headers: Record<string, string> = { 'X-Velora-Client': 'web', Accept: 'application/json', ...opts.headers };
  const gid = getGuestId();
  if (gid) headers['X-Guest-Id'] = gid;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'We could not reach VÉLORA. Check your connection and try again.');
  }

  const json = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!res.ok || !json || json.success === false) {
    const err = json && json.success === false ? json.error : null;
    const fieldErrors: Record<string, string> = {};
    if (Array.isArray(err?.details)) {
      for (const d of err.details as Array<{ field: string; messages: string[] }>) {
        if (d?.field && d.messages?.length) fieldErrors[d.field] = d.messages[0];
      }
    }
    throw new ApiError(
      res.status,
      err?.code ?? 'ERROR',
      err?.message ?? (res.status >= 500 ? 'Something went wrong on our side. Please try again.' : 'Request failed.'),
      fieldErrors,
    );
  }
  return { data: json.data, meta: json.meta };
}

/** Calls the API; on a 401 it refreshes the session once and retries. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await apiWithMeta<T>(path, opts)).data;
}

export async function apiWithMeta<T>(path: string, opts: RequestOptions = {}) {
  const token = useSession.getState().accessToken;
  try {
    return await raw<T>(path, opts, token);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401 || !token || opts.auth === false) throw e;
    const refreshed = await refreshSession();
    if (!refreshed) throw e;
    return raw<T>(path, opts, useSession.getState().accessToken);
  }
}

export interface SessionPayload {
  user: AuthUser;
  tokens: AuthTokens;
}

let inflight: Promise<boolean> | null = null;

/** Single-flight: concurrent 401s share one refresh request (refresh tokens rotate on every use). */
export function refreshSession(): Promise<boolean> {
  inflight ??= raw<SessionPayload>('/auth/refresh', { method: 'POST', body: {}, auth: false }, null)
    .then(({ data }) => {
      useSession.getState().signIn(data);
      return true;
    })
    .catch(() => {
      useSession.getState().signOutLocal();
      return false;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
