import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { Permission } from '@velora/shared';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';
import type { AccessTokenPayload } from '../types';
import { PrincipalService } from '../../modules/auth/principal.service';

/**
 * Global guard #1: verifies the bearer access token and loads the principal from the database
 * on every request, so suspended users and revoked roles take effect immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly principals: PrincipalService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
    const token = extractBearer(req);

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException('Authentication required');
    }
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      if (payload.typ !== 'access') throw new Error('wrong token type');
      const user = await this.principals.load(payload.sub);
      if (!user) throw new Error('inactive');
      req.user = user;
      return true;
    } catch {
      // On public routes a bad token just means "anonymous"; elsewhere it is a 401.
      if (isPublic) return true;
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}

/** Global guard #2: checks @RequirePermissions metadata. The frontend hiding a menu is never relied on. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;
    const user = ctx.switchToHttp().getRequest().user as { permissions: string[] } | undefined;
    if (!user) throw new UnauthorizedException('Authentication required');
    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length) throw new ForbiddenException('You do not have permission to perform this action');
    return true;
  }
}

function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const [scheme, value] = h.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
