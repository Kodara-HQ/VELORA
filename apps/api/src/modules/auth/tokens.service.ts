import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { randomToken, sha256 } from '../../common/utils/request';
import type { AccessTokenPayload, RequestContext } from '../../common/types';
import type { Env } from '../../config/env';

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Access tokens: short-lived JWTs (default 15 min).
 * Refresh tokens: opaque random strings, stored only as SHA-256 hashes, rotated on every use.
 * Re-use of an already-rotated token means it was stolen → the whole token family is revoked.
 */
@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(userId: number, ctx: RequestContext, familyId: string = randomUUID()): Promise<IssuedTokens> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    const payload: AccessTokenPayload = { sub: userId, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn });

    const refreshToken = randomToken();
    const refreshExpiresAt = new Date(Date.now() + this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000);
    await this.prisma.refreshToken.create({
      data: { userId, familyId, tokenHash: sha256(refreshToken), expiresAt: refreshExpiresAt, ipAddress: ctx.ip, userAgent: ctx.userAgent },
    });
    return { accessToken, expiresIn, refreshToken, refreshExpiresAt };
  }

  async rotate(presented: string, ctx: RequestContext): Promise<{ userId: number; tokens: IssuedTokens }> {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presented) } });
    if (!record) throw new UnauthorizedException('Session expired. Please sign in again.');

    if (record.revokedAt) {
      // Reuse detected — someone is replaying a rotated token. Kill every session in this family.
      await this.revokeFamily(record.familyId);
      this.logger.warn(`Refresh token reuse detected for user ${record.userId}; family ${record.familyId} revoked`);
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    if (record.expiresAt < new Date()) throw new UnauthorizedException('Session expired. Please sign in again.');

    // Conditional update guards against two concurrent refreshes both succeeding.
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) {
      await this.revokeFamily(record.familyId);
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    const tokens = await this.issue(record.userId, ctx, record.familyId);
    const next = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(tokens.refreshToken) } });
    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { replacedBy: next?.id } });
    return { userId: record.userId, tokens };
  }

  async revoke(presented: string) {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presented) } });
    if (record) await this.revokeFamily(record.familyId);
    return record?.userId ?? null;
  }

  revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  revokeAllForUser(userId: number) {
    return this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
