import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@velora/shared';
import type { RequestUser } from '../types';

export const IS_PUBLIC_KEY = 'isPublic';
/** Route is reachable without an access token. Everything else requires one (secure by default). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Caller must hold ALL listed permissions. Enforced server-side by PermissionsGuard. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestUser => {
  return ctx.switchToHttp().getRequest().user;
});
