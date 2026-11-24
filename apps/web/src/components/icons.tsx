import type { SVGProps } from 'react';

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...props,
});

export const SearchIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
export const BagIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>;
export const HeartIcon = ({ filled, ...p }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? 'currentColor' : 'none'}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
);
export const UserIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
export const MenuIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
export const CloseIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>;
export const ChevronIcon = ({ dir = 'right', ...p }: SVGProps<SVGSVGElement> & { dir?: 'left' | 'right' | 'down' | 'up' }) => (
  <svg {...base(p)} style={{ transform: { right: 'none', left: 'rotate(180deg)', down: 'rotate(90deg)', up: 'rotate(-90deg)' }[dir] }}><path d="m9 6 6 6-6 6" /></svg>
);
export const EyeIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>;
export const TruckIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>;
export const ReturnIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>;
export const ShieldIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
export const FilterIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base(p)}><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
export const StarIcon = ({ filled = 1, ...p }: SVGProps<SVGSVGElement> & { filled?: number }) => {
  const id = `s${Math.round(filled * 100)}`;
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" {...p}>
      <defs><linearGradient id={id}><stop offset={`${filled * 100}%`} stopColor="currentColor" /><stop offset={`${filled * 100}%`} stopColor="#e3dfd8" /></linearGradient></defs>
      <path fill={`url(#${id})`} d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9L12 2.5Z" />
    </svg>
  );
};
