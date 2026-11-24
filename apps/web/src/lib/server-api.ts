import { notFound } from 'next/navigation';
import type { PaginationMeta } from '@velora/shared';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

export class ServerApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Server-side fetch for public catalogue data (rendered on the server for speed and SEO). */
export async function serverApi<T>(path: string, opts: { notFoundOn404?: boolean } = {}): Promise<{ data: T; meta?: PaginationMeta }> {
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}/api/v1${path}`, {
      headers: { Accept: 'application/json', 'X-Velora-Client': 'web' },
      cache: 'no-store',
    });
  } catch {
    throw new ServerApiError(503, 'The VÉLORA service is unavailable. Please try again shortly.');
  }
  if (res.status === 404 && opts.notFoundOn404) notFound();
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new ServerApiError(res.status, json?.error?.message ?? 'Request failed');
  return { data: json.data as T, meta: json.meta };
}
