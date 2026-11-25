import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseIntPipe, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { FitFeedback, LoyaltyTxnType, ModerationStatus, OrderStatus, Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Request } from 'express';
import { PERMISSIONS, type AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';
import { requestContext } from '../../common/utils/request';
import { AuditService } from '../audit/audit.module';
import { LoyaltyService } from '../loyalty/loyalty.module';
import { NotificationsService } from '../notifications/notifications.module';

const blank = ({ value }: { value: unknown }) => (typeof value === 'string' && !value.trim() ? undefined : typeof value === 'string' ? value.trim() : value);
const REVIEWABLE: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.COMPLETED, OrderStatus.PARTIALLY_REFUNDED];

class ReviewDto {
  @ApiProperty() @IsInt() orderItemId: number;
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1, { message: 'Choose a star rating' }) @Max(5) rating: number;
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsString() @MaxLength(150) title?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsString() @MinLength(10, { message: 'Tell us a little more (10 characters or more)' }) @MaxLength(3000) body?: string;
  @ApiPropertyOptional({ enum: FitFeedback }) @IsOptional() @IsEnum(FitFeedback) fit?: FitFeedback;
}

class ModerationQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ModerationStatus }) @IsOptional() @IsEnum(ModerationStatus) status?: ModerationStatus;
  @ApiPropertyOptional() @IsOptional() @IsIn(['1', '2', '3', '4', '5']) rating?: string;
}

class RejectDto {
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsString() @MaxLength(255) reason?: string;
}

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Delivered items the customer hasn't reviewed yet. */
  async reviewable(userId: number) {
    const items = await this.prisma.orderItem.findMany({
      where: { order: { userId, status: { in: REVIEWABLE } }, productId: { not: null }, review: null, product: { deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, productName: true, variantLabel: true, imageUrl: true, product: { select: { slug: true } }, order: { select: { orderNumber: true, shipments: { select: { deliveredAt: true } } } } },
    });
    // One prompt per product: reviewing it once is enough.
    const seen = new Set<string>();
    return items.filter((i) => !seen.has(i.product!.slug) && seen.add(i.product!.slug)).map((i) => ({
      orderItemId: i.id, name: i.productName, variantLabel: i.variantLabel, image: i.imageUrl, slug: i.product!.slug,
      orderNumber: i.order.orderNumber, deliveredAt: i.order.shipments.find((x) => x.deliveredAt)?.deliveredAt ?? null,
    }));
  }

  async mine(userId: number) {
    const rows = await this.prisma.productReview.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' }, take: 50,
      select: { id: true, rating: true, title: true, body: true, fit: true, status: true, createdAt: true, product: { select: { name: true, slug: true } } },
    });
    return rows;
  }

  async create(user: AuthUser, dto: ReviewDto) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: dto.orderItemId, order: { userId: user.id } },
      include: { order: { select: { status: true } }, review: { select: { id: true } }, product: { select: { id: true, name: true, deletedAt: true } } },
    });
    if (!item || !item.product || item.product.deletedAt) throw new NotFoundException('We could not find that item in your orders');
    if (!REVIEWABLE.includes(item.order.status)) throw new BadRequestException('You can review an item once it has been delivered');
    if (item.review) throw new ConflictException('You have already reviewed this item');
    if (await this.prisma.productReview.findFirst({ where: { userId: user.id, productId: item.product.id, status: { not: ModerationStatus.REJECTED } } })) {
      throw new ConflictException('You have already reviewed this product');
    }
    try {
      const review = await this.prisma.productReview.create({
        data: { productId: item.product.id, userId: user.id, orderItemId: item.id, rating: dto.rating, title: dto.title, body: dto.body, fit: dto.fit, isVerifiedBuyer: true },
      });
      await this.notifications.notify(await this.notifications.staffWith(PERMISSIONS.REVIEWS_MODERATE), {
        type: 'review.submitted', title: 'Review to moderate', body: `${dto.rating}★ for “${item.product.name}”.`, data: { href: '/admin/reviews?status=PENDING' },
      });
      return { id: review.id, status: review.status };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('You have already reviewed this item');
      throw e;
    }
  }

  async list(q: ModerationQuery) {
    const where: Prisma.ProductReviewWhereInput = {
      status: q.status, ...(q.rating && { rating: Number(q.rating) }),
      ...(q.q?.trim() && { OR: [{ body: { contains: q.q.trim() } }, { product: { name: { contains: q.q.trim() } } }] }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({ where, orderBy: { createdAt: q.order }, skip: q.skip, take: q.pageSize,
        select: { id: true, rating: true, title: true, body: true, fit: true, status: true, isVerifiedBuyer: true, createdAt: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } }, product: { select: { id: true, name: true, slug: true } } } }),
      this.prisma.productReview.count({ where }),
    ]);
    return new Paginated(rows, total, q);
  }

  private async refreshRating(tx: Prisma.TransactionClient, productId: number) {
    const agg = await tx.productReview.aggregate({ where: { productId, status: ModerationStatus.APPROVED }, _avg: { rating: true }, _count: { _all: true } });
    await tx.product.update({ where: { id: productId }, data: { avgRating: new Prisma.Decimal(agg._avg.rating ?? 0).toDecimalPlaces(2), reviewCount: agg._count._all } });
  }

  async moderate(staff: AuthUser, id: number, approve: boolean, reason: string | undefined, req: Request) {
    const review = await this.prisma.productReview.findUnique({ where: { id }, include: { product: { select: { name: true, slug: true } } } });
    if (!review) throw new NotFoundException('Review not found');
    const settings = await this.loyalty.settings();
    await this.prisma.$transaction(async (tx) => {
      const from = approve ? [ModerationStatus.PENDING, ModerationStatus.REJECTED] : [ModerationStatus.PENDING, ModerationStatus.APPROVED];
      const r = await tx.productReview.updateMany({ where: { id, status: { in: from } }, data: { status: approve ? ModerationStatus.APPROVED : ModerationStatus.REJECTED } });
      if (r.count !== 1) throw new ConflictException(`This review is already ${approve ? 'approved' : 'rejected'}`);
      await this.refreshRating(tx, review.productId);
      if (approve) {
        // The bonus is paid once per review, the first time it's approved.
        const paid = await tx.loyaltyTransaction.count({ where: { type: LoyaltyTxnType.REVIEW_BONUS, description: { endsWith: `#${id}` } } });
        if (!paid && review.isVerifiedBuyer) {
          await this.loyalty.credit(tx, review.userId, settings.reviewBonusPoints, LoyaltyTxnType.REVIEW_BONUS, `Review of ${review.product.name} #${id}`);
        }
        await this.notifications.notify(review.userId, {
          type: 'review.approved', title: 'Your review is live',
          body: `Thanks for reviewing ${review.product.name}${!paid && review.isVerifiedBuyer ? `. ${settings.reviewBonusPoints} points have been added to your account.` : '.'}`,
          data: { href: `/p/${review.product.slug}#reviews` },
        }, tx);
      } else {
        await this.notifications.notify(review.userId, {
          type: 'review.rejected', title: 'About your review',
          body: `We couldn't publish your review of ${review.product.name}${reason ? `: ${reason}` : '. It may not meet our review guidelines.'}`,
        }, tx);
      }
      await this.audit.log({ userId: staff.id, action: approve ? 'reviews.approved' : 'reviews.rejected', entityType: 'product_review', entityId: id, newValues: reason ? { reason } : undefined, ctx: requestContext(req) }, tx);
    });
    return { id, status: approve ? ModerationStatus.APPROVED : ModerationStatus.REJECTED };
  }
}

@ApiTags('Reviews')
@ApiBearerAuth()
@Controller()
export class ReviewsController {
  constructor(private readonly svc: ReviewsService) {}

  @Get('me/reviewable') reviewable(@CurrentUser() u: AuthUser) { return this.svc.reviewable(u.id); }
  @Get('me/reviews') mine(@CurrentUser() u: AuthUser) { return this.svc.mine(u.id); }
  @Post('me/reviews') create(@CurrentUser() u: AuthUser, @Body() dto: ReviewDto) { return this.svc.create(u, dto); }

  @Get('admin/reviews') @RequirePermissions(PERMISSIONS.REVIEWS_MODERATE) list(@Query() q: ModerationQuery) { return this.svc.list(q); }
  @Post('admin/reviews/:id/approve') @HttpCode(200) @RequirePermissions(PERMISSIONS.REVIEWS_MODERATE)
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.moderate(u, id, true, undefined, r); }
  @Post('admin/reviews/:id/reject') @HttpCode(200) @RequirePermissions(PERMISSIONS.REVIEWS_MODERATE)
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.moderate(u, id, false, dto.reason, r); }
}

@Module({ controllers: [ReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}
