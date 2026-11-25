import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseIntPipe, Patch, Post, Put, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { DiscountType, Prisma, PromotionType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min,
  MinLength, ValidateNested,
} from 'class-validator';
import type { Request } from 'express';
import { PERMISSIONS, type AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';
import { requestContext } from '../../common/utils/request';
import type { RequestContext } from '../../common/types';
import { AuditService } from '../audit/audit.module';
import { slugify } from '../admin/admin-products.service';
import { cardSelect, visibleWhere } from '../catalog/product-card';
import { PRICE_PROMOTIONS, activePromotionWhere, promoUnitPrice, toCards, type ActivePromo } from './promo-pricing';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blank = ({ value }: { value: unknown }) => (typeof value === 'string' && !value.trim() ? undefined : trim({ value }));
const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

// ─── DTOs ───

class PromotionProductInput {
  @ApiProperty() @IsInt() productId: number;
  @ApiPropertyOptional({ description: 'Fixed sale price for this product (overrides the promotion value)' })
  @IsOptional() @Transform(blank) @Matches(MONEY, { message: 'Enter a price like 99.00' }) salePrice?: string;
  @ApiPropertyOptional({ description: 'Units available at the promotional price' }) @IsOptional() @IsInt() @Min(1) @Max(100000) stockLimit?: number;
}

class PromotionDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3) @MaxLength(150) name: string;
  @ApiProperty({ enum: PRICE_PROMOTIONS }) @IsIn(PRICE_PROMOTIONS) type: PromotionType;
  @ApiPropertyOptional({ description: 'Percent off (PERCENTAGE_OFF / FLASH_SALE) or GH₵ off (FIXED_AMOUNT_OFF)' })
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100000) value?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsString() @MaxLength(150) headline?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsUrl({ require_tld: false }) @MaxLength(512) bannerUrl?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsString() @MaxLength(100) campaign?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100) priority?: number;
  @ApiProperty() @IsDateString({}, { message: 'Choose a start date and time' }) startsAt: string;
  @ApiProperty() @IsDateString({}, { message: 'Choose an end date and time' }) endsAt: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ type: [PromotionProductInput] }) @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PromotionProductInput)
  products: PromotionProductInput[];
}

class PromotionQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['live', 'scheduled', 'ended', 'paused'] }) @IsOptional() @IsIn(['live', 'scheduled', 'ended', 'paused']) status?: string;
}

class CouponDto {
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9_-]{3,40}$/, { message: 'Use 3–40 letters, numbers, - or _' }) code: string;
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsString() @MaxLength(255) description?: string;
  @ApiProperty({ enum: DiscountType }) @IsEnum(DiscountType) type: DiscountType;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100000) value: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) minOrderAmount?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) maxDiscountAmount?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) usageLimit?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) usageLimitPerUser?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() firstOrderOnly?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

class CouponQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['active', 'inactive', 'expired'] }) @IsOptional() @IsIn(['active', 'inactive', 'expired']) status?: string;
}

const statusWhere = (s: string | undefined, now = new Date()): Prisma.PromotionWhereInput =>
  s === 'live' ? { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } }
  : s === 'scheduled' ? { isActive: true, startsAt: { gt: now } }
  : s === 'ended' ? { endsAt: { lte: now } }
  : s === 'paused' ? { isActive: false, endsAt: { gt: now } }
  : {};

export const promotionState = (p: { isActive: boolean; startsAt: Date; endsAt: Date }, now = new Date()) =>
  p.endsAt <= now ? 'ENDED' : !p.isActive ? 'PAUSED' : p.startsAt > now ? 'SCHEDULED' : 'LIVE';

// ─── Service ───

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async validate(dto: PromotionDto) {
    const starts = new Date(dto.startsAt);
    const ends = new Date(dto.endsAt);
    const fail = (field: string, msg: string) => new BadRequestException({ message: msg, code: 'VALIDATION_FAILED', details: [{ field, messages: [msg] }] });
    if (ends <= starts) throw fail('endsAt', 'The end must be after the start');
    if (dto.type === PromotionType.PERCENTAGE_OFF && (!dto.value || dto.value >= 100)) throw fail('value', 'Enter a percentage between 1 and 99');
    if (dto.type === PromotionType.FIXED_AMOUNT_OFF && !dto.value) throw fail('value', 'Enter the amount off');
    if (dto.type === PromotionType.FLASH_SALE) {
      if (dto.value != null && dto.value >= 100) throw fail('value', 'Enter a percentage between 1 and 99');
      if (!dto.value && dto.products.some((p) => !p.salePrice)) throw fail('value', 'Set a percentage off, or a sale price for every product');
    }
    if (!dto.products.length) throw fail('products', 'Add at least one product');
    const ids = dto.products.map((p) => p.productId);
    if (new Set(ids).size !== ids.length) throw fail('products', 'Each product can only be added once');
    const products = await this.prisma.product.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, name: true, basePrice: true } });
    if (products.length !== ids.length) throw fail('products', 'Some products no longer exist');
    for (const p of dto.products) {
      const base = products.find((x) => x.id === p.productId)!;
      if (p.salePrice && new Prisma.Decimal(p.salePrice).gte(base.basePrice)) throw fail('products', `${base.name}: the sale price must be below GH₵${base.basePrice.toFixed(2)}`);
      if (!p.salePrice && dto.type === PromotionType.FIXED_AMOUNT_OFF && dto.value && base.basePrice.lte(dto.value)) throw fail('products', `${base.name}: GH₵${dto.value} off would make it free`);
    }
  }

  async list(q: PromotionQuery) {
    const where: Prisma.PromotionWhereInput = {
      type: { in: PRICE_PROMOTIONS }, ...statusWhere(q.status),
      ...(q.q?.trim() && { OR: [{ name: { contains: q.q.trim() } }, { campaign: { contains: q.q.trim() } }] }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.promotion.findMany({ where, orderBy: { startsAt: q.order }, skip: q.skip, take: q.pageSize, include: { _count: { select: { products: true } } } }),
      this.prisma.promotion.count({ where }),
    ]);
    const perf = await this.performance(rows.map((r) => r.id));
    return new Paginated(rows.map(({ _count, ...p }) => ({
      ...p, value: p.value?.toFixed(2) ?? null, state: promotionState(p), productCount: _count.products,
      unitsSold: perf.get(p.id)?.units ?? 0, revenue: (perf.get(p.id)?.revenue ?? 0).toFixed(2), orders: perf.get(p.id)?.orders ?? 0,
    })), total, q);
  }

  private async performance(ids: number[]) {
    if (!ids.length) return new Map<number, { units: number; revenue: number; orders: number }>();
    const rows = await this.prisma.$queryRaw<Array<{ promotion_id: number; units: bigint; revenue: Prisma.Decimal; orders: bigint }>>`
      SELECT oi.promotion_id, SUM(oi.quantity - oi.quantity_returned) AS units, SUM(oi.line_total) AS revenue, COUNT(DISTINCT oi.order_id) AS orders
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.promotion_id IN (${Prisma.join(ids)}) AND o.status NOT IN ('CANCELLED', 'PENDING_PAYMENT')
      GROUP BY oi.promotion_id`;
    return new Map(rows.map((r) => [Number(r.promotion_id), { units: Number(r.units), revenue: Number(r.revenue), orders: Number(r.orders) }]));
  }

  async get(id: number) {
    const p = await this.prisma.promotion.findUnique({
      where: { id },
      include: { products: { include: { product: { select: { id: true, name: true, styleCode: true, basePrice: true, status: true, images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } } } } } } },
    });
    if (!p) throw new NotFoundException('Promotion not found');
    const perf = (await this.performance([id])).get(id);
    const asPromo: ActivePromo = { promotionId: p.id, name: p.name, slug: p.slug, type: p.type, headline: p.headline, endsAt: p.endsAt, value: p.value, salePrice: null, stockLimit: null, soldCount: 0 };
    return {
      ...p, value: p.value?.toFixed(2) ?? null, state: promotionState(p),
      performance: { unitsSold: perf?.units ?? 0, revenue: (perf?.revenue ?? 0).toFixed(2), orders: perf?.orders ?? 0 },
      products: p.products.map((pp) => ({
        productId: pp.productId, name: pp.product.name, styleCode: pp.product.styleCode, status: pp.product.status, image: pp.product.images[0]?.url ?? null,
        basePrice: pp.product.basePrice.toFixed(2), salePrice: pp.salePrice?.toFixed(2) ?? null, stockLimit: pp.stockLimit, soldCount: pp.soldCount,
        promoPrice: promoUnitPrice(pp.product.basePrice, { ...asPromo, salePrice: pp.salePrice })?.toFixed(2) ?? null,
      })),
    };
  }

  private async uniqueSlug(name: string, exceptId?: number) {
    const base = slugify(name) || 'sale';
    let slug = base;
    for (let n = 2; ; n++) {
      const clash = await this.prisma.promotion.findUnique({ where: { slug }, select: { id: true } });
      if (!clash || clash.id === exceptId) return slug;
      slug = `${base}-${n}`;
    }
  }

  async create(user: AuthUser, dto: PromotionDto, ctx: RequestContext) {
    await this.validate(dto);
    const p = await this.prisma.$transaction(async (tx) => {
      const created = await tx.promotion.create({
        data: {
          name: dto.name, slug: await this.uniqueSlug(dto.name), type: dto.type, value: dto.value, headline: dto.headline, bannerUrl: dto.bannerUrl,
          campaign: dto.campaign, priority: dto.priority ?? 0, startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt), isActive: dto.isActive ?? true,
          products: { create: dto.products.map((x) => ({ productId: x.productId, salePrice: x.salePrice, stockLimit: x.stockLimit })) },
        },
      });
      await this.audit.log({ userId: user.id, action: 'promotions.created', entityType: 'promotion', entityId: created.id, newValues: { name: dto.name, type: dto.type, products: dto.products.length }, ctx }, tx);
      return created;
    });
    return this.get(p.id);
  }

  async update(user: AuthUser, id: number, dto: PromotionDto, ctx: RequestContext) {
    const current = await this.prisma.promotion.findUnique({ where: { id }, include: { products: true } });
    if (!current) throw new NotFoundException('Promotion not found');
    if (current.endsAt <= new Date()) throw new ConflictException('Ended promotions cannot be edited. Duplicate it instead.');
    await this.validate(dto);
    await this.prisma.$transaction(async (tx) => {
      await tx.promotion.update({
        where: { id },
        data: {
          name: dto.name, slug: current.name === dto.name ? current.slug : await this.uniqueSlug(dto.name, id), type: dto.type, value: dto.value ?? null,
          headline: dto.headline ?? null, bannerUrl: dto.bannerUrl ?? null, campaign: dto.campaign ?? null, priority: dto.priority ?? 0,
          startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt), isActive: dto.isActive ?? current.isActive,
        },
      });
      // Units already sold stay counted against each product's allocation.
      const keep = dto.products.map((x) => x.productId);
      await tx.promotionProduct.deleteMany({ where: { promotionId: id, productId: { notIn: keep } } });
      for (const x of dto.products) {
        const sold = current.products.find((c) => c.productId === x.productId)?.soldCount ?? 0;
        if (x.stockLimit != null && x.stockLimit < sold) throw new BadRequestException(`A limit can't be below the ${sold} already sold`);
        await tx.promotionProduct.upsert({
          where: { promotionId_productId: { promotionId: id, productId: x.productId } },
          create: { promotionId: id, productId: x.productId, salePrice: x.salePrice, stockLimit: x.stockLimit },
          update: { salePrice: x.salePrice ?? null, stockLimit: x.stockLimit ?? null },
        });
      }
      await this.audit.log({ userId: user.id, action: 'promotions.updated', entityType: 'promotion', entityId: id, newValues: { name: dto.name, products: dto.products.length }, ctx }, tx);
    });
    return this.get(id);
  }

  async setActive(user: AuthUser, id: number, action: 'pause' | 'resume' | 'end', ctx: RequestContext) {
    const p = await this.prisma.promotion.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Promotion not found');
    const now = new Date();
    if (p.endsAt <= now) throw new ConflictException('This promotion has already ended');
    await this.prisma.promotion.update({ where: { id }, data: action === 'end' ? { endsAt: now } : { isActive: action === 'resume' } });
    await this.audit.log({ userId: user.id, action: `promotions.${action}`, entityType: 'promotion', entityId: id, ctx });
    return this.get(id);
  }

  // Storefront

  /** Promotions running now (and flash sales starting within a week), each with a few product cards. */
  async live() {
    const now = new Date();
    const promos = await this.prisma.promotion.findMany({
      where: { OR: [activePromotionWhere(now), { isActive: true, type: PromotionType.FLASH_SALE, startsAt: { gt: now, lte: new Date(now.getTime() + 7 * 86_400_000) } }] },
      orderBy: [{ priority: 'desc' }, { endsAt: 'asc' }],
      take: 6,
    });
    const out = [];
    for (const p of promos) {
      const rows = await this.prisma.product.findMany({ where: { AND: [visibleWhere(), { promotionProducts: { some: { promotionId: p.id } } }] }, select: cardSelect, orderBy: { soldCount: 'desc' }, take: 12 });
      const upcoming = p.startsAt > now;
      out.push({
        name: p.name, slug: p.slug, type: p.type, headline: p.headline, bannerUrl: p.bannerUrl, startsAt: p.startsAt, endsAt: p.endsAt,
        state: upcoming ? 'SCHEDULED' : 'LIVE', value: p.value?.toFixed(2) ?? null,
        // Upcoming sales show the products without the sale price (it isn't live yet).
        products: await toCards(this.prisma, rows),
      });
    }
    return out;
  }

  async publicOne(slug: string) {
    const p = await this.prisma.promotion.findFirst({ where: { slug, isActive: true, type: { in: PRICE_PROMOTIONS } } });
    if (!p) throw new NotFoundException('This sale is not available');
    return { name: p.name, slug: p.slug, type: p.type, headline: p.headline, bannerUrl: p.bannerUrl, startsAt: p.startsAt, endsAt: p.endsAt, state: promotionState(p), value: p.value?.toFixed(2) ?? null };
  }

  // Coupons

  async coupons(q: CouponQuery) {
    const now = new Date();
    const where: Prisma.CouponWhereInput = {
      ...(q.status === 'active' && { isActive: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }),
      ...(q.status === 'inactive' && { isActive: false }),
      ...(q.status === 'expired' && { endsAt: { lte: now } }),
      ...(q.q?.trim() && { code: { contains: q.q.trim().toUpperCase() } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.coupon.findMany({ where, orderBy: { createdAt: q.order }, skip: q.skip, take: q.pageSize }),
      this.prisma.coupon.count({ where }),
    ]);
    const sums = rows.length ? await this.prisma.couponRedemption.groupBy({ by: ['couponId'], where: { couponId: { in: rows.map((r) => r.id) } }, _sum: { discountAmount: true }, _count: { _all: true } }) : [];
    return new Paginated(rows.map((c) => {
      const s = sums.find((x) => x.couponId === c.id);
      return {
        ...c, value: c.value.toFixed(2), minOrderAmount: c.minOrderAmount?.toFixed(2) ?? null, maxDiscountAmount: c.maxDiscountAmount?.toFixed(2) ?? null,
        redemptions: s?._count._all ?? 0, discountGiven: (s?._sum.discountAmount ?? new Prisma.Decimal(0)).toFixed(2),
        state: !c.isActive ? 'INACTIVE' : c.endsAt && c.endsAt <= now ? 'EXPIRED' : c.startsAt && c.startsAt > now ? 'SCHEDULED' : 'ACTIVE',
      };
    }), total, q);
  }

  private couponData(dto: CouponDto) {
    if (dto.type === DiscountType.PERCENTAGE && (dto.value <= 0 || dto.value > 90)) {
      throw new BadRequestException({ message: 'Percentage must be between 1 and 90', code: 'VALIDATION_FAILED', details: [{ field: 'value', messages: ['Enter 1–90'] }] });
    }
    if (dto.startsAt && dto.endsAt && new Date(dto.endsAt) <= new Date(dto.startsAt)) {
      throw new BadRequestException({ message: 'The end must be after the start', code: 'VALIDATION_FAILED', details: [{ field: 'endsAt', messages: ['The end must be after the start'] }] });
    }
    return {
      code: dto.code, description: dto.description ?? null, type: dto.type, value: dto.type === DiscountType.FREE_SHIPPING ? 0 : dto.value,
      minOrderAmount: dto.minOrderAmount ?? null, maxDiscountAmount: dto.maxDiscountAmount ?? null, usageLimit: dto.usageLimit ?? null,
      usageLimitPerUser: dto.usageLimitPerUser ?? null, firstOrderOnly: dto.firstOrderOnly ?? false,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null, endsAt: dto.endsAt ? new Date(dto.endsAt) : null, isActive: dto.isActive ?? true,
    };
  }

  async createCoupon(user: AuthUser, dto: CouponDto, ctx: RequestContext) {
    if (await this.prisma.coupon.findUnique({ where: { code: dto.code } })) {
      throw new ConflictException({ message: 'That code already exists', code: 'VALIDATION_FAILED', details: [{ field: 'code', messages: ['That code already exists'] }] });
    }
    const c = await this.prisma.coupon.create({ data: this.couponData(dto) });
    await this.audit.log({ userId: user.id, action: 'coupons.created', entityType: 'coupon', entityId: c.code, newValues: { type: dto.type, value: dto.value }, ctx });
    return c;
  }

  async updateCoupon(user: AuthUser, id: number, dto: CouponDto, ctx: RequestContext) {
    const c = await this.prisma.coupon.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Coupon not found');
    // A used code keeps its name so past orders and statements still match.
    if (c.code !== dto.code && c.usedCount > 0) throw new ConflictException('This code has been used, so it cannot be renamed');
    const data = this.couponData(dto);
    const updated = await this.prisma.coupon.update({ where: { id }, data });
    await this.audit.log({ userId: user.id, action: 'coupons.updated', entityType: 'coupon', entityId: c.code, oldValues: { isActive: c.isActive, value: c.value.toFixed(2) }, newValues: { ...dto }, ctx });
    return updated;
  }
}

// ─── Controllers ───

@ApiTags('Promotions')
@Public()
@Controller('promotions')
export class PromotionsPublicController {
  constructor(private readonly svc: PromotionsService) {}
  @Get('live') live() { return this.svc.live(); }
  @Get(':slug') one(@Param('slug') slug: string) { return this.svc.publicOne(slug); }
}

@ApiTags('Admin · Promotions')
@ApiBearerAuth()
@Controller('admin')
export class AdminPromotionsController {
  constructor(private readonly svc: PromotionsService) {}

  @Get('promotions') @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE) list(@Query() q: PromotionQuery) { return this.svc.list(q); }
  @Get('promotions/:id') @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE) get(@Param('id', ParseIntPipe) id: number) { return this.svc.get(id); }
  @Post('promotions') @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE)
  create(@Body() dto: PromotionDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.create(u, dto, requestContext(r)); }
  @Put('promotions/:id') @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: PromotionDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.update(u, id, dto, requestContext(r)); }
  @Post('promotions/:id/:action') @HttpCode(200) @RequirePermissions(PERMISSIONS.PROMOTIONS_MANAGE)
  act(@Param('id', ParseIntPipe) id: number, @Param('action') action: string, @CurrentUser() u: AuthUser, @Req() r: Request) {
    if (action !== 'pause' && action !== 'resume' && action !== 'end') throw new NotFoundException();
    return this.svc.setActive(u, id, action, requestContext(r));
  }

  @Get('coupons') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE) coupons(@Query() q: CouponQuery) { return this.svc.coupons(q); }
  @Post('coupons') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  createCoupon(@Body() dto: CouponDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.createCoupon(u, dto, requestContext(r)); }
  @Patch('coupons/:id') @RequirePermissions(PERMISSIONS.COUPONS_MANAGE)
  updateCoupon(@Param('id', ParseIntPipe) id: number, @Body() dto: CouponDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.updateCoupon(u, id, dto, requestContext(r)); }
}

@Module({ controllers: [PromotionsPublicController, AdminPromotionsController], providers: [PromotionsService], exports: [PromotionsService] })
export class PromotionsModule {}
