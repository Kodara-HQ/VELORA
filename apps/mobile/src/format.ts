/** GH₵1,234.50 — formatted by hand so it is identical on Hermes (Android), iOS and web. */
export function money(amount: string | number) {
  const n = Number(amount);
  const [whole, frac] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '−' : ''}GH₵${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

export const percentOff = (price: string, compareAt?: string | null) =>
  compareAt && Number(compareAt) > Number(price) ? Math.round((1 - Number(price) / Number(compareAt)) * 100) : 0;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

export const humanize = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return shortDate(iso);
};
