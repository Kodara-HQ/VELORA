import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '@velora/shared';

/**
 * Who is browsing: a signed-in user, an anonymous guest (identified by the random
 * X-Guest-Id the client generates and keeps), or both during the moment of sign-in.
 */
export interface ViewerRef {
  userId: number | null;
  guestId: string | null;
  email: string | null;
}

export const GUEST_HEADER = 'x-guest-id';
const GUEST_RULE = /^[A-Za-z0-9_-]{16,64}$/;

export function readGuestId(headers: Record<string, string | string[] | undefined>): string | null {
  const raw = headers[GUEST_HEADER];
  return typeof raw === 'string' && GUEST_RULE.test(raw) ? raw : null;
}

export const Viewer = createParamDecorator((_: unknown, ctx: ExecutionContext): ViewerRef => {
  const req = ctx.switchToHttp().getRequest<{ user?: AuthUser; headers: Record<string, string | string[] | undefined> }>();
  return { userId: req.user?.id ?? null, guestId: readGuestId(req.headers), email: req.user?.email ?? null };
});

export function requireViewer(v: ViewerRef) {
  if (!v.userId && !v.guestId) throw new BadRequestException('Missing guest session. Refresh the page and try again.');
}
