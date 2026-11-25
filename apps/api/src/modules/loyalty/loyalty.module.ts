import {
  BadRequestException, Body, ConflictException, Controller, Get, Global, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseIntPipe, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { LoyaltyTier, LoyaltyTxnType, Prisma, ReferralStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength, NotEquals } from 'class-validator';
import type { Request } from 'express';
import { PERMISSIONS, type AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';
import { requestContext } from '../../common/utils/request';
import { AuditService } from '../audit/audit.module';
import { NotificationsService } from '../notifications/notifications.module';

type Tx = Prisma.TransactionClient;

/** Tiers are earned on lifetime points and multiply what each GH₵ earns. */
export const TIERS: Array<{ tier: LoyaltyTier; min: number; multiplier: number; perks: string[] }> = [
  { tier: 'BRONZE', min: 0, multiplier: 1, perks: ['1 point per GH₵1', 'Birthday surprise'] },
  { tier: 'SILVER', min: 2500, multiplier: 1.25, perks: ['1.25× points', 'Early access to flash sales'] },
  { tier: 'GOLD', min: 8000, multiplier: 1.5, perks: ['1.5× points', 'Free express delivery in Greater Accra'] },
  { tier: 'PLATINUM', min: 20000, multiplier: 2, perks: ['2× points', 'Priority support', 'Private styling sessions'] },
];
export const tierFor = (lifetime: number) => [...TIERS].reverse().find((t) => lifetime >= t.min)!;

export interface LoyaltySettings {
  pointsPerCedi: number; cediPerPoint: number; minRedeemPoints: number; maxRedeemPercent: number;
  referralBonusPoints: number; refereeBonusPoints: number; reviewBonusPoints: number;
}
const DEFAULTS: LoyaltySettings = {
  pointsPerCedi: 1, cediPerPoint: 0.05, minRedeemPoints: 200, maxRedeemPercent: 50,
  referralBonusPoints: 500, refereeBonusPoints: 250, reviewBonusPoints: 50,
};
/** Types that count towards lifetime points (and therefore tier). Spending and reversals don't. */
const EARNING: LoyaltyTxnType[] = [LoyaltyTxnType.EARN, LoyaltyTxnType.REFERRAL_BONUS, LoyaltyTxnType.REVIEW_BONUS];

export interface Redemption { points: number; value: Prisma.Decimal; balance: number; maxPoints: number }

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async settings(): Promise<LoyaltySettings> {
    const rows = await this.prisma.systemSetting.findMany({ where: { group: 'loyalty' } });
    const out = { ...DEFAULTS };
    for (const r of rows) if (r.key in out && Number.isFinite(Number(r.value))) out[r.key as keyof LoyaltySettings] = Number(r.value);
    return out;
  }

  /** Adds points. Earning types also raise lifetime points and can move the member up a tier. */
  async credit(tx: Tx, userId: number, points: number, type: LoyaltyTxnType, description: string, orderId?: number) {
    if (points <= 0) return null;
    const acct = await tx.loyaltyAccount.upsert({ where: { userId }, create: { userId }, update: {} });
    const earning = EARNING.includes(type);
    const updated = await tx.loyaltyAccount.update({
      where: { id: acct.id },
      data: { pointsBalance: { increment: points }, ...(earning && { lifetimePoints: { increment: points } }) },
    });
    await tx.loyaltyTransaction.create({ data: { accountId: acct.id, type, points, balanceAfter: updated.pointsBalance, orderId, description: description.slice(0, 255) } });
    const tier = tierFor(updated.lifetimePoints).tier;
    if (earning && tier !== updated.tier && TIERS.findIndex((t) => t.tier === tier) > TIERS.findIndex((t) => t.tier === updated.tier)) {
      await tx.loyaltyAccount.update({ where: { id: acct.id }, data: { tier } });
      await this.notifications.notify(userId, {
        type: 'loyalty.tier', title: `You're now VÉLORA ${tier.charAt(0)}${tier.slice(1).toLowerCase()}`,
        body: `New perks unlocked: ${TIERS.find((t) => t.tier === tier)!.perks.join(', ')}.`, data: { href: '/account/loyalty' },
      }, tx);
    }
    return updated;
  }

  /** Removes points only if the balance covers them (never goes negative, safe under concurrency). */
  async debit(tx: Tx, userId: number, points: number, type: LoyaltyTxnType, description: string, orderId?: number) {
    if (points <= 0) return;
    const r = await tx.loyaltyAccount.updateMany({ where: { userId, pointsBalance: { gte: points } }, data: { pointsBalance: { decrement: points } } });
    if (r.count !== 1) throw new ConflictException({ message: 'You no longer have enough points. Please review your order.', code: 'POINTS_UNAVAILABLE' });
    const acct = await tx.loyaltyAccount.findUniqueOrThrow({ where: { userId } });
    await tx.loyaltyTransaction.create({ data: { accountId: acct.id, type, points: -points, balanceAfter: acct.pointsBalance, orderId, description } });
  }

  /**
   * How many points can be applied to an order. `merchandise` is the amount after coupons, before delivery.
   * Throws for a request the shopper can't make, so the total they confirm is the total they pay.
   */
  async redemption(userId: number | null, merchandise: Prisma.Decimal, requested: number | undefined): Promise<Redemption | null> {
    if (!userId) {
      if (requested) throw new BadRequestException({ message: 'Sign in to use your points', code: 'POINTS_UNAVAILABLE' });
      return null;
    }
    const [s, acct] = await Promise.all([this.settings(), this.prisma.loyaltyAccount.findUnique({ where: { userId } })]);
    const balance = acct?.pointsBalance ?? 0;
    const cap = Math.floor((Number(merchandise) * s.maxRedeemPercent) / 100 / s.cediPerPoint);
    const maxPoints = Math.max(0, Math.min(balance, cap));
    const points = requested ?? 0;
    if (points) {
      if (points < s.minRedeemPoints) throw new BadRequestException({ message: `Redeem at least ${s.minRedeemPoints} points`, code: 'POINTS_UNAVAILABLE' });
      if (points > maxPoints) {
        throw new ConflictException({ message: `You can use up to ${maxPoints} points on this order`, code: 'POINTS_UNAVAILABLE', details: { maxPoints } });
      }
    }
    return { points, value: new Prisma.Decimal(points).mul(s.cediPerPoint).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN), balance, maxPoints: maxPoints >= s.minRedeemPoints ? maxPoints : 0 };
  }

  /** Gives back redeemed points (all of them on cancellation, a share on a partial refund). Never more than were used. */
  async restoreRedeemed(tx: Tx, order: { id: number; userId: number | null; orderNumber: string; loyaltyPointsUsed: number }, fraction: number, why: string) {
    if (!order.userId || order.loyaltyPointsUsed <= 0) return;
    const back = await tx.loyaltyTransaction.aggregate({ where: { orderId: order.id, type: LoyaltyTxnType.ADJUST, points: { gt: 0 }, description: { startsWith: 'Points returned' } }, _sum: { points: true } });
    const left = order.loyaltyPointsUsed - (back._sum.points ?? 0);
    const pts = Math.min(left, Math.round(order.loyaltyPointsUsed * Math.min(1, fraction)));
    if (pts > 0) await this.credit(tx, order.userId, pts, LoyaltyTxnType.ADJUST, `Points returned: ${why} (${order.orderNumber})`, order.id);
  }

  /** Points for a delivered order (tier multiplier applied) plus the referral reward on a first order. */
  async earnForOrder(tx: Tx, o: { id: number; userId: number | null; orderNumber: string; grandTotal: Prisma.Decimal; shippingTotal: Prisma.Decimal }) {
    if (!o.userId) return;
    const s = await this.settings();
    const acct = await tx.loyaltyAccount.upsert({ where: { userId: o.userId }, create: { userId: o.userId }, update: {} });
    const mult = TIERS.find((t) => t.tier === acct.tier)!.multiplier;
    // Earned on what was paid for merchandise: delivery and the part paid with points don't earn.
    const points = Math.floor(Number(o.grandTotal.sub(o.shippingTotal)) * s.pointsPerCedi * mult);
    await this.credit(tx, o.userId, points, LoyaltyTxnType.EARN, `Order ${o.orderNumber}${mult > 1 ? ` (${mult}× ${acct.tier.toLowerCase()})` : ''}`, o.id);

    const referral = await tx.referral.findUnique({ where: { refereeId: o.userId } });
    if (referral && referral.status !== ReferralStatus.REWARDED) {
      // Claim it first so two deliveries racing can't both pay the bonus.
      const claimed = await tx.referral.updateMany({ where: { id: referral.id, status: { not: ReferralStatus.REWARDED } }, data: { status: ReferralStatus.REWARDED, rewardedAt: new Date() } });
      if (claimed.count === 1) {
        await this.credit(tx, referral.referrerId, s.referralBonusPoints, LoyaltyTxnType.REFERRAL_BONUS, 'A friend you referred received their first order');
        await this.credit(tx, o.userId, s.refereeBonusPoints, LoyaltyTxnType.REFERRAL_BONUS, 'Welcome bonus for joining through a friend');
        await this.notifications.notify(referral.referrerId, { type: 'loyalty.referral', title: `+${s.referralBonusPoints} points`, body: 'A friend you invited just received their first VÉLORA order. Thank you!', data: { href: '/account/loyalty' } }, tx);
      }
    }
  }

  async summary(userId: number) {
    const [s, acct, user, referrals] = await Promise.all([
      this.settings(),
      this.prisma.loyaltyAccount.upsert({ where: { userId }, create: { userId }, update: {} }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } }),
      this.prisma.referral.groupBy({ by: ['status'], where: { referrerId: userId }, _count: { _all: true } }),
    ]);
    const idx = TIERS.findIndex((t) => t.tier === acct.tier);
    const next = TIERS[idx + 1] ?? null;
    return {
      pointsBalance: acct.pointsBalance, lifetimePoints: acct.lifetimePoints, tier: acct.tier,
      pointsValue: (acct.pointsBalance * s.cediPerPoint).toFixed(2),
      multiplier: TIERS[idx].multiplier, perks: TIERS[idx].perks,
      nextTier: next && { tier: next.tier, pointsNeeded: Math.max(0, next.min - acct.lifetimePoints), min: next.min, currentMin: TIERS[idx].min },
      referral: {
        code: user.referralCode, bonusPoints: s.referralBonusPoints, friendBonusPoints: s.refereeBonusPoints,
        invited: referrals.reduce((n, r) => n + r._count._all, 0),
        rewarded: referrals.find((r) => r.status === ReferralStatus.REWARDED)?._count._all ?? 0,
      },
      rules: { pointsPerCedi: s.pointsPerCedi, cediPerPoint: s.cediPerPoint, minRedeemPoints: s.minRedeemPoints, maxRedeemPercent: s.maxRedeemPercent, reviewBonusPoints: s.reviewBonusPoints },
    };
  }

  async history(userId: number, q: PaginationQuery) {
    const acct = await this.prisma.loyaltyAccount.findUnique({ where: { userId } });
    if (!acct) return new Paginated([], 0, q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.loyaltyTransaction.findMany({ where: { accountId: acct.id }, orderBy: { id: 'desc' }, skip: q.skip, take: q.pageSize,
        select: { id: true, type: true, points: true, balanceAfter: true, description: true, createdAt: true, order: { select: { orderNumber: true } } } }),
      this.prisma.loyaltyTransaction.count({ where: { accountId: acct.id } }),
    ]);
    return new Paginated(rows.map(({ order, ...r }) => ({ ...r, orderNumber: order?.orderNumber ?? null })), total, q);
  }

  async program() {
    const s = await this.settings();
    return { tiers: TIERS, rules: s };
  }
}

class AdjustPointsDto {
  @ApiProperty({ description: 'Signed: positive adds, negative removes' }) @IsInt() @NotEquals(0) @Min(-100000) @Max(100000) points: number;
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(5, { message: 'Give a reason (shown to the customer)' }) @MaxLength(200) reason: string;
}

@ApiTags('Loyalty')
@Controller()
export class LoyaltyController {
  constructor(
    private readonly loyalty: LoyaltyService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Public() @Get('loyalty/program')
  program() { return this.loyalty.program(); }

  @ApiBearerAuth() @Get('me/loyalty')
  mine(@CurrentUser() u: AuthUser) { return this.loyalty.summary(u.id); }

  @ApiBearerAuth() @Get('me/loyalty/transactions')
  transactions(@CurrentUser() u: AuthUser, @Query() q: PaginationQuery) { return this.loyalty.history(u.id, q); }

  @ApiBearerAuth() @Post('admin/customers/:id/loyalty/adjust') @HttpCode(200) @RequirePermissions(PERMISSIONS.LOYALTY_MANAGE)
  async adjust(@Param('id', ParseIntPipe) id: number, @Body() dto: AdjustPointsDto, @CurrentUser() u: AuthUser, @Req() r: Request) {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!user) throw new NotFoundException('Customer not found');
    await this.prisma.$transaction(async (tx) => {
      // Manual adjustments never change tier: they're corrections, not spending.
      if (dto.points > 0) await this.loyalty.credit(tx, id, dto.points, LoyaltyTxnType.ADJUST, dto.reason);
      else await this.loyalty.debit(tx, id, -dto.points, LoyaltyTxnType.ADJUST, dto.reason);
      await this.audit.log({ userId: u.id, action: 'loyalty.adjusted', entityType: 'user', entityId: id, newValues: { ...dto }, ctx: requestContext(r) }, tx);
    });
    return this.loyalty.summary(id);
  }
}

@Global()
@Module({ controllers: [LoyaltyController], providers: [LoyaltyService], exports: [LoyaltyService] })
export class LoyaltyModule {}
