import type { AuthUser } from '@velora/shared';

/** The authenticated principal attached to every protected request. Loaded fresh from the DB. */
export type RequestUser = AuthUser;

export interface AccessTokenPayload {
  sub: number;
  typ: 'access';
}

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}
