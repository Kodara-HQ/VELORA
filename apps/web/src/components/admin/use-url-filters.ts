'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/** Admin list filters live in the URL so views are shareable and survive refresh. */
export function useUrlFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string) => params.get(k) ?? '';
  const set = useCallback((k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v); else p.delete(k);
    if (k !== 'page') p.delete('page');
    router.replace(`${pathname}?${p}`, { scroll: false });
  }, [params, router, pathname]);
  return { get, set };
}
