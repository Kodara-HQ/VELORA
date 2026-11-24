const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** Formats a decimal string from the API (e.g. "389.00") without float rounding surprises. */
export function formatMoney(amount: string | number, currency = 'GHS') {
  let f = moneyFormatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('en-GH', { style: 'currency', currency, minimumFractionDigits: 2 });
    moneyFormatters.set(currency, f);
  }
  return f.format(typeof amount === 'string' ? Number(amount) : amount);
}

export function discountPercent(price: string, compareAt?: string | null) {
  if (!compareAt) return null;
  const p = Number(price);
  const c = Number(compareAt);
  if (!(c > p)) return null;
  return Math.round(((c - p) / c) * 100);
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/** Only allow same-site relative redirects (prevents open-redirects via ?next=). */
export function safeNext(next: string | null | undefined, fallback = '/account') {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}
