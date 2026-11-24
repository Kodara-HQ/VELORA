'use client';

import { ApiError, refreshSession } from './api';
import { useSession } from './session';

/** Authenticated fetch for non-JSON bodies (file uploads, CSV downloads), with one refresh-and-retry on 401. */
async function authed(path: string, init: RequestInit): Promise<Response> {
  const go = () => fetch(`/api/v1${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'X-Velora-Client': 'web', ...(useSession.getState().accessToken && { Authorization: `Bearer ${useSession.getState().accessToken}` }), ...init.headers },
  });
  let res = await go();
  if (res.status === 401 && (await refreshSession())) res = await go();
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    const fieldErrors: Record<string, string> = {};
    for (const d of (json?.error?.details as Array<{ field: string; messages: string[] }>) ?? []) if (d?.field) fieldErrors[d.field] = d.messages[0];
    throw new ApiError(res.status, json?.error?.code ?? 'ERROR', json?.error?.message ?? 'Request failed', fieldErrors);
  }
  return res;
}

export async function uploadFiles<T>(path: string, field: string, files: File[] | File) {
  const form = new FormData();
  for (const f of Array.isArray(files) ? files : [files]) form.append(field, f);
  const res = await authed(path, { method: 'POST', body: form });
  return (await res.json()).data as T;
}

/** Downloads an authenticated file (e.g. CSV export) without exposing the token in a URL. */
export async function downloadFile(path: string, fallbackName: string) {
  const res = await authed(path, { method: 'GET' });
  const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));
