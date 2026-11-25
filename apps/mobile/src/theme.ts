/** VÉLORA brand tokens, shared with the website. */
export const colors = {
  ink: '#111111',
  paper: '#FFFFFF',
  ivory: '#F8F7F4',
  rose: '#D9A0A7',
  roseDeep: '#B5707A',
  muted: '#777777',
  line: '#E6E3DD',
  sand: '#EFEBE4',
  success: '#2F7D4F',
  danger: '#B3261E',
} as const;

export const space = (n: number) => n * 4;

export const type = {
  display: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.5, color: colors.ink },
  h1: { fontSize: 24, fontWeight: '800' as const, color: colors.ink },
  h2: { fontSize: 18, fontWeight: '800' as const, color: colors.ink },
  body: { fontSize: 15, color: colors.ink, lineHeight: 21 },
  small: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  eyebrow: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 2.5, textTransform: 'uppercase' as const, color: colors.roseDeep },
};
