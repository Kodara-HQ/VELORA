import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { PrincipalService } from './principal.service';
import { TokensService } from './tokens.service';
import { randomToken, sha256 } from '../../common/utils/request';
import type { RequestContext } from '../../common/types';
import type { Env } from '../../config/env';
import type { ChangePasswordDto, LoginDto, RegisterDto, ResetPasswordDto } from './dto/auth.dto';

const HASH_OPTS = { type: argon2.argon2id } as const;
const RESET_TTL_MS = 30 * 60_000;
const GENERIC_LOGIN_ERROR = 'Incorrect email or password';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Verified against when the email is unknown, so response time doesn't reveal which emails exist. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly principals: PrincipalService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async register(dto: RegisterDto, ctx: RequestContext) {
    const clash = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, ...(dto.phone ? [{ phone: dto.phone }] : [])] },
      select: { email: true },
    });
    if (clash) {
      throw new ConflictException(
        clash.email === dto.email ? 'An account with this email already exists' : 'This phone number is already registered',
      );
    }
    const referrer = dto.referralCode
      ? await this.prisma.user.findUnique({ where: { referralCode: dto.referralCode.toUpperCase() }, select: { id: true } })
      : null;
    if (dto.referralCode && !referrer) throw new BadRequestException('That referral code is not valid');

    const passwordHash = await argon2.hash(dto.password, HASH_OPTS);
    const customerRole = await this.prisma.role.findUniqueOrThrow({ where: { code: 'customer' } });

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email,
          phone: dto.phone,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          referralCode: `VEL${randomBytes(4).toString('hex').toUpperCase()}`,
          roles: { create: { roleId: customerRole.id } },
          customer: { create: { marketingOptIn: dto.marketingOptIn ?? false } },
          loyaltyAccount: { create: {} },
          wishlists: { create: { name: 'My Wishlist' } },
          ...(referrer && { referredBy: { create: { referrerId: referrer.id } } }),
        },
      });
      await this.audit.log({ userId: created.id, action: 'auth.register', entityType: 'user', entityId: created.id, ctx }, tx);
      return created;
    });

    return this.startSession(user.id, ctx);
  }

  async login(dto: LoginDto, ctx: RequestContext) {
    const user = await this.prisma.user.findFirst({ where: { email: dto.email, deletedAt: null } });

    if (!user) {
      await argon2.verify(await this.getDummyHash(), dto.password).catch(() => false);
      await this.recordLogin(null, dto.email, false, 'unknown_email', ctx);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordLogin(user.id, dto.email, false, 'locked', ctx);
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new HttpException(
        { message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.`, code: 'ACCOUNT_LOCKED' },
        HttpStatus.LOCKED,
      );
    }

    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) {
      const failed = user.failedLogins + 1;
      const max = this.config.get('LOGIN_MAX_FAILED_ATTEMPTS', { infer: true });
      const lock = failed >= max;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + this.config.get('LOGIN_LOCK_MINUTES', { infer: true }) * 60_000) : undefined,
        },
      });
      await this.recordLogin(user.id, dto.email, false, lock ? 'bad_password_locked' : 'bad_password', ctx);
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (user.status !== UserStatus.ACTIVE) {
      await this.recordLogin(user.id, dto.email, false, `status_${user.status.toLowerCase()}`, ctx);
      throw new HttpException({ message: 'This account is not active. Please contact customer care.', code: 'ACCOUNT_INACTIVE' }, HttpStatus.FORBIDDEN);
    }

    // Transparently upgrade hashes if argon2 parameters change in future.
    const rehash = argon2.needsRehash(user.passwordHash) ? await argon2.hash(dto.password, HASH_OPTS) : undefined;
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), ...(rehash && { passwordHash: rehash }) },
    });
    await this.recordLogin(user.id, dto.email, true, null, ctx);
    return this.startSession(user.id, ctx);
  }

  async refresh(presented: string | undefined, ctx: RequestContext) {
    if (!presented) throw new UnauthorizedException('Session expired. Please sign in again.');
    const { userId, tokens } = await this.tokens.rotate(presented, ctx);
    const user = await this.principals.load(userId);
    if (!user) {
      await this.tokens.revokeAllForUser(userId);
      throw new UnauthorizedException('This account is not active.');
    }
    return { user, tokens };
  }

  async logout(presented: string | undefined, ctx: RequestContext) {
    if (!presented) return;
    const userId = await this.tokens.revoke(presented);
    if (userId) await this.audit.log({ userId, action: 'auth.logout', entityType: 'user', entityId: userId, ctx });
  }

  async logoutEverywhere(userId: number, ctx: RequestContext) {
    await this.tokens.revokeAllForUser(userId);
    await this.audit.log({ userId, action: 'auth.logout_all', entityType: 'user', entityId: userId, ctx });
  }

  /** Always succeeds from the caller's point of view, so it can't be used to discover accounts. */
  async forgotPassword(email: string, ctx: RequestContext) {
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null, status: UserStatus.ACTIVE } });
    if (!user) return;
    const token = randomToken(32);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      }),
    ]);
    await this.audit.log({ userId: user.id, action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id, ctx });

    const link = `${this.config.get('WEB_APP_URL', { infer: true })}/reset-password?token=${token}`;
    // Email delivery is wired up with the notifications module (Phase 6).
    // Until then the link is only logged in development so the flow can be exercised locally.
    if (this.config.get('NODE_ENV', { infer: true }) === 'development') {
      this.logger.log(`[dev] Password reset link for ${email}: ${link}`);
    }
  }

  async resetPassword(dto: ResetPasswordDto, ctx: RequestContext) {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(dto.token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired. Please request a new one.');
    }
    const passwordHash = await argon2.hash(dto.password, HASH_OPTS);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException('This reset link has already been used.');
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash, failedLogins: 0, lockedUntil: null } });
      await tx.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ userId: record.userId, action: 'auth.password_reset', entityType: 'user', entityId: record.userId, ctx }, tx);
    });
  }

  async changePassword(userId: number, dto: ChangePasswordDto, ctx: RequestContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, dto.currentPassword))) {
      throw new BadRequestException('Your current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) throw new BadRequestException('Choose a password you have not used here before');
    const passwordHash = await argon2.hash(dto.newPassword, HASH_OPTS);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ userId, action: 'auth.password_changed', entityType: 'user', entityId: userId, ctx }, tx);
    });
    return this.startSession(userId, ctx);
  }

  loginActivity(userId: number) {
    return this.prisma.loginActivity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, success: true, reason: true, ipAddress: true, userAgent: true, createdAt: true },
    });
  }

  private async startSession(userId: number, ctx: RequestContext) {
    const user = await this.principals.load(userId);
    if (!user) throw new UnauthorizedException('This account is not active.');
    const tokens = await this.tokens.issue(userId, ctx);
    return { user, tokens };
  }

  private recordLogin(userId: number | null, email: string, success: boolean, reason: string | null, ctx: RequestContext) {
    return this.prisma.loginActivity.create({
      data: { userId, email: email.slice(0, 191), success, reason, ipAddress: ctx.ip, userAgent: ctx.userAgent },
    });
  }

  private getDummyHash() {
    this.dummyHash ??= argon2.hash(randomToken(16), HASH_OPTS);
    return this.dummyHash;
  }
}
