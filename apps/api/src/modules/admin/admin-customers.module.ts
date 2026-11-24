import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseIntPipe, Patch, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma, UserStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { PERMISSIONS, type AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';
import { requestContext } from '../../common/utils/request';
import { AuditService } from '../audit/audit.module';
import { orderSummary } from '../orders/order-presenter';

export const SEGMENTS = ['VIP', 'LOYAL', 'NEW', 'AT_RISK', 'PROSPECT', 'REGULAR'] as const;
type Segment = (typeof SEGMENTS)[number];

const VIP_LTV = 2000;
const DAY = 86_400_000;

/** Rule-based segments, evaluated in order. Kept in one place so list filters and labels agree. */
function segmentOf(c: { lifetimeValue: number; orderCount: number; lastOrderAt: Date | null; createdAt: Date }): Segment {
  const now = Date.now();
  if (c.lifetimeValue >= VIP_LTV) return 'VIP';
  if (c.orderCount === 0) return now - c.createdAt.getTime() < 30 * DAY ? 'NEW' : 'PROSPECT';
  if (c.lastOrderAt && now - c.lastOrderAt.getTime() > 90 * DAY) return 'AT_RISK';
  if (c.orderCount >= 3) return 'LOYAL';
  if (now - c.createdAt.getTime() < 30 * DAY) return 'NEW';
  return 'REGULAR';
}

function segmentWhere(s: Segment): Prisma.UserWhereInput {
  const ago = (d: number) => new Date(Date.now() - d * DAY);
  const ltv = (op: 'gte' | 'lt') => ({ customer: { lifetimeValue: { [op]: VIP_LTV } } });
  switch (s) {
    case 'VIP': return ltv('gte');
    case 'PROSPECT': return { AND: [ltv('lt'), { customer: { orderCount: 0 } }, { createdAt: { lt: ago(30) } }] };
    case 'AT_RISK': return { AND: [ltv('lt'), { customer: { orderCount: { gt: 0 }, lastOrderAt: { lt: ago(90) } } }] };
    case 'LOYAL': return { AND: [ltv('lt'), { customer: { orderCount: { gte: 3 }, OR: [{ lastOrderAt: null }, { lastOrderAt: { gte: ago(90) } }] } }] };
    case 'NEW': return { AND: [ltv('lt'), { createdAt: { gte: ago(30) } }, { customer: { orderCount: { lt: 3 }, OR: [{ lastOrderAt: null }, { lastOrderAt: { gte: ago(90) } }] } }] };
    case 'REGULAR': return { AND: [ltv('lt'), { createdAt: { lt: ago(30) } }, { customer: { orderCount: { gt: 0, lt: 3 }, lastOrderAt: { gte: ago(90) } } }] };
  }
}

class CustomerQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: SEGMENTS }) @IsOptional() @IsIn(SEGMENTS as unknown as string[]) segment?: Segment;
  @ApiPropertyOptional({ enum: UserStatus }) @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @ApiPropertyOptional({ enum: ['recent', 'ltv', 'orders', 'name'] }) @IsOptional() @IsIn(['recent', 'ltv', 'orders', 'name']) sort: 'recent' | 'ltv' | 'orders' | 'name' = 'recent';
}

class StatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] }) @IsIn(['ACTIVE', 'SUSPENDED']) status: 'ACTIVE' | 'SUSPENDED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

@Injectable()
export class AdminCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: CustomerQuery) {
    const and: Prisma.UserWhereInput[] = [{ deletedAt: null, roles: { some: { role: { code: 'customer' } } } }];
    if (q.status) and.push({ status: q.status });
    if (q.segment) and.push(segmentWhere(q.segment));
    if (q.q?.trim()) {
      const t = q.q.trim();
      and.push({ OR: [{ email: { contains: t } }, { firstName: { contains: t } }, { lastName: { contains: t } }, { phone: { contains: t } }] });
    }
    const where: Prisma.UserWhereInput = { AND: and };
    const orderBy: Prisma.UserOrderByWithRelationInput =
      q.sort === 'ltv' ? { customer: { lifetimeValue: 'desc' } } : q.sort === 'orders' ? { customer: { orderCount: 'desc' } }
      : q.sort === 'name' ? { firstName: 'asc' } : { createdAt: 'desc' };
    const [rows, total, counts] = await Promise.all([
      this.prisma.user.findMany({
        where, orderBy, skip: q.skip, take: q.pageSize,
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true, createdAt: true, lastLoginAt: true,
          customer: { select: { orderCount: true, lifetimeValue: true, lastOrderAt: true, marketingOptIn: true } },
          loyaltyAccount: { select: { tier: true, pointsBalance: true } } },
      }),
      this.prisma.user.count({ where }),
      Promise.all(SEGMENTS.map(async (s) => [s, await this.prisma.user.count({ where: { AND: [and[0], segmentWhere(s)] } })] as const)),
    ]);
    const page = new Paginated(rows.map((u) => {
      const c = { lifetimeValue: Number(u.customer?.lifetimeValue ?? 0), orderCount: u.customer?.orderCount ?? 0, lastOrderAt: u.customer?.lastOrderAt ?? null, createdAt: u.createdAt };
      return {
        id: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email, phone: u.phone, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
        orderCount: c.orderCount, lifetimeValue: c.lifetimeValue.toFixed(2), lastOrderAt: c.lastOrderAt,
        averageOrderValue: c.orderCount ? (c.lifetimeValue / c.orderCount).toFixed(2) : '0.00',
        marketingOptIn: u.customer?.marketingOptIn ?? false, tier: u.loyaltyAccount?.tier ?? 'BRONZE', points: u.loyaltyAccount?.pointsBalance ?? 0,
        segment: segmentOf(c),
      };
    }), total, q);
    return { items: page.items, meta: page.meta, segments: Object.fromEntries(counts) };
  }

  async get(id: number) {
    const u = await this.prisma.user.findFirst({
      where: { id, deletedAt: null, roles: { some: { role: { code: 'customer' } } } },
      include: {
        customer: true, loyaltyAccount: { include: { transactions: { orderBy: { createdAt: 'desc' }, take: 10 } } },
        addresses: { where: { deletedAt: null } },
        loginActivities: { orderBy: { createdAt: 'desc' }, take: 10 },
        orders: { orderBy: { placedAt: 'desc' }, take: 20, select: { orderNumber: true, status: true, paymentStatus: true, placedAt: true, grandTotal: true, currency: true,
          items: { select: { quantity: true, imageUrl: true, productName: true } } } },
        wishlists: { select: { _count: { select: { items: true } } } },
        returns: { orderBy: { createdAt: 'desc' }, take: 10, select: { returnNumber: true, status: true, reason: true, createdAt: true } },
      },
    });
    if (!u) throw new NotFoundException('Customer not found');
    const c = { lifetimeValue: Number(u.customer?.lifetimeValue ?? 0), orderCount: u.customer?.orderCount ?? 0, lastOrderAt: u.customer?.lastOrderAt ?? null, createdAt: u.createdAt };
    return {
      id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
      emailVerified: !!u.emailVerifiedAt, referralCode: u.referralCode,
      stats: { orderCount: c.orderCount, lifetimeValue: c.lifetimeValue.toFixed(2), averageOrderValue: c.orderCount ? (c.lifetimeValue / c.orderCount).toFixed(2) : '0.00',
        lastOrderAt: c.lastOrderAt, wishlistItems: u.wishlists.reduce((s, w) => s + w._count.items, 0) },
      segment: segmentOf(c),
      marketingOptIn: u.customer?.marketingOptIn ?? false,
      loyalty: u.loyaltyAccount && { tier: u.loyaltyAccount.tier, pointsBalance: u.loyaltyAccount.pointsBalance, lifetimePoints: u.loyaltyAccount.lifetimePoints, transactions: u.loyaltyAccount.transactions },
      addresses: u.addresses,
      orders: u.orders.map(orderSummary),
      returns: u.returns,
      loginActivity: u.loginActivities.map((l) => ({ success: l.success, reason: l.reason, ipAddress: l.ipAddress, userAgent: l.userAgent, createdAt: l.createdAt })),
    };
  }

  async setStatus(actor: AuthUser, id: number, dto: StatusDto, req: Request) {
    const u = await this.prisma.user.findFirst({ where: { id, deletedAt: null, roles: { some: { role: { code: 'customer' } } } } });
    if (!u) throw new NotFoundException('Customer not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: dto.status } });
      if (dto.status !== 'ACTIVE') await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ userId: actor.id, action: 'customers.status_changed', entityType: 'user', entityId: id, oldValues: { status: u.status }, newValues: { ...dto }, ctx: requestContext(req) }, tx);
    });
    return this.get(id);
  }
}

@ApiTags('Admin · Customers')
@ApiBearerAuth()
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly svc: AdminCustomersService) {}

  @Get() @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  list(@Query() q: CustomerQuery) { return this.svc.list(q); }

  @Get(':id') @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  get(@Param('id', ParseIntPipe) id: number) { return this.svc.get(id); }

  @Patch(':id/status') @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  status(@Param('id', ParseIntPipe) id: number, @Body() dto: StatusDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.setStatus(u, id, dto, r); }
}

@Module({ controllers: [AdminCustomersController], providers: [AdminCustomersService] })
export class AdminCustomersModule {}
