/** Joins class names, skipping falsy values. Plain module so both server and client components can use it. */
export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');
