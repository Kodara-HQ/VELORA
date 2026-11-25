import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module,
  NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Public } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';
import { GH_PHONE_RULE } from '../auth/dto/auth.dto';
import { AddressInput } from '../checkout/checkout.dto';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';
import { cardSelect, visibleWhere } from '../catalog/product-card';
import { toCards } from '../promotions/promo-pricing';
import { orderInclude, orderSummary, presentOrder } from '../orders/order-presenter';

class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value?.trim()) @IsString() @MinLength(1) @MaxLength(100) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value?.trim()) @IsString() @MinLength(1) @MaxLength(100) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') : value))
  @Matches(GH_PHONE_RULE, { message: 'Enter a Ghana mobile number like +233241234567' }) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() marketingOptIn?: boolean;
}

class AddressDto extends AddressInput {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

class WishlistAddDto {
  @ApiProperty() @IsInt() productId: number;
}

class CancelDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

class NewsletterDto {
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(191)
  email: string;
}

const addressSelect = {
  id: true, label: true, recipientName: true, phone: true, line1: true, line2: true, city: true, region: true,
  digitalAddress: true, landmark: true, countryCode: true, isDefault: true,
} satisfies Prisma.AddressSelect;

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  async overview(userId: number) {
    const [user, orders, wishlist, addresses] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { firstName: true, lastName: true, email: true, phone: true, referralCode: true, createdAt: true,
          customer: { select: { marketingOptIn: true } },
          loyaltyAccount: { select: { pointsBalance: true, lifetimePoints: true, tier: true } } },
      }),
      this.prisma.order.count({ where: { userId } }),
      this.prisma.wishlistItem.count({ where: { wishlist: { userId } } }),
      this.prisma.address.count({ where: { userId, deletedAt: null } }),
    ]);
    return {
      profile: { firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone,
        marketingOptIn: user.customer?.marketingOptIn ?? false, referralCode: user.referralCode, memberSince: user.createdAt },
      loyalty: user.loyaltyAccount ?? { pointsBalance: 0, lifetimePoints: 0, tier: 'BRONZE' },
      counts: { orders, wishlist, addresses },
    };
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    if (dto.phone) {
      const clash = await this.prisma.user.findFirst({ where: { phone: dto.phone, id: { not: userId } }, select: { id: true } });
      if (clash) throw new ConflictException('That phone number is used by another account');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName, lastName: dto.lastName, phone: dto.phone,
        ...(dto.marketingOptIn !== undefined && { customer: { upsert: { create: { marketingOptIn: dto.marketingOptIn }, update: { marketingOptIn: dto.marketingOptIn } } } }),
      },
    });
    return this.overview(userId);
  }

  // ─── Addresses ───

  addresses(userId: number) {
    return this.prisma.address.findMany({ where: { userId, deletedAt: null }, select: addressSelect, orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] });
  }

  async createAddress(userId: number, dto: AddressDto) {
    const count = await this.prisma.address.count({ where: { userId, deletedAt: null } });
    if (count >= 10) throw new BadRequestException('You can save up to 10 addresses');
    const makeDefault = dto.isDefault || count === 0;
    return this.prisma.$transaction(async (tx) => {
      if (makeDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      const { isDefault: _ignored, ...data } = dto;
      return tx.address.create({ data: { ...data, userId, isDefault: makeDefault }, select: addressSelect });
    });
  }

  async updateAddress(userId: number, id: number, dto: AddressDto) {
    await this.ownAddress(userId, id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      const { isDefault, ...data } = dto;
      return tx.address.update({ where: { id }, data: { ...data, ...(isDefault && { isDefault: true }) }, select: addressSelect });
    });
  }

  async deleteAddress(userId: number, id: number) {
    const a = await this.ownAddress(userId, id);
    await this.prisma.$transaction(async (tx) => {
      // Soft delete: old orders keep their own address snapshot anyway.
      await tx.address.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
      if (a.isDefault) {
        const next = await tx.address.findFirst({ where: { userId, deletedAt: null }, orderBy: { id: 'asc' } });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
    return this.addresses(userId);
  }

  private async ownAddress(userId: number, id: number) {
    const a = await this.prisma.address.findFirst({ where: { id, userId, deletedAt: null } });
    if (!a) throw new NotFoundException('Address not found');
    return a;
  }

  // ─── Orders ───

  async orders(userId: number, q: PaginationQuery) {
    const where: Prisma.OrderWhereInput = { userId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where, orderBy: { placedAt: 'desc' }, skip: q.skip, take: q.pageSize,
        select: { orderNumber: true, status: true, paymentStatus: true, placedAt: true, grandTotal: true, currency: true,
          items: { select: { quantity: true, imageUrl: true, productName: true } } },
      }),
      this.prisma.order.count({ where }),
    ]);
    return new Paginated(rows.map(orderSummary), total, q);
  }

  async order(userId: number, orderNumber: string) {
    const o = await this.prisma.order.findFirst({ where: { orderNumber, userId }, include: orderInclude });
    if (!o) throw new NotFoundException('Order not found');
    return presentOrder(o);
  }

  /** Customer cancellation: releases reserved stock, voids the coupon use and reverses vendor commissions atomically. */
  /** Customer cancellation (before dispatch). Stock, coupon, commissions and any payment are unwound by the shared lifecycle. */
  async cancel(userId: number, orderNumber: string, reason?: string) {
    const o = await this.prisma.order.findFirst({ where: { orderNumber, userId }, include: orderInclude });
    if (!o) throw new NotFoundException('Order not found');
    if (!presentOrder(o).canCancel) {
      throw new ConflictException({ message: 'This order has already been dispatched and can no longer be cancelled. You can request a return after delivery.', code: 'NOT_CANCELLABLE' });
    }
    await this.prisma.$transaction((tx) => this.lifecycle.cancel(tx, o.id, { by: userId, reason: reason?.trim() || 'Cancelled by customer', historyNote: 'Cancelled by customer' }));
    return this.order(userId, orderNumber);
  }

  // ─── Wishlist ───

  private async wishlistId(userId: number) {
    const w = await this.prisma.wishlist.findFirst({ where: { userId }, orderBy: { id: 'asc' }, select: { id: true } });
    return w?.id ?? (await this.prisma.wishlist.create({ data: { userId } })).id;
  }

  async wishlist(userId: number) {
    const id = await this.wishlistId(userId);
    const items = await this.prisma.wishlistItem.findMany({
      where: { wishlistId: id, product: visibleWhere() },
      orderBy: { addedAt: 'desc' },
      select: { addedAt: true, product: { select: cardSelect } },
    });
    const cards = await toCards(this.prisma, items.map((i) => i.product));
    return items.map((i, n) => ({ addedAt: i.addedAt, product: cards[n] }));
  }

  async wishlistIds(userId: number) {
    const rows = await this.prisma.wishlistItem.findMany({ where: { wishlist: { userId } }, select: { productId: true } });
    return rows.map((r) => r.productId);
  }

  async addToWishlist(userId: number, productId: number) {
    const ok = await this.prisma.product.count({ where: { AND: [visibleWhere(), { id: productId }] } });
    if (!ok) throw new NotFoundException('Product not found');
    const wishlistId = await this.wishlistId(userId);
    const count = await this.prisma.wishlistItem.count({ where: { wishlistId } });
    if (count >= 200) throw new BadRequestException('Your wishlist is full (200 items)');
    await this.prisma.wishlistItem.upsert({
      where: { wishlistId_productId: { wishlistId, productId } },
      create: { wishlistId, productId },
      update: {},
    });
    return this.wishlistIds(userId);
  }

  async removeFromWishlist(userId: number, productId: number) {
    await this.prisma.wishlistItem.deleteMany({ where: { productId, wishlist: { userId } } });
    return this.wishlistIds(userId);
  }

  async subscribe(email: string) {
    await this.prisma.newsletterSubscriber.upsert({
      where: { email },
      create: { email, source: 'web' },
      update: { unsubscribedAt: null },
    });
    return { message: "You're on the list. Look out for new arrivals and member offers." };
  }
}

@ApiTags('My account')
@ApiBearerAuth()
@Controller('me')
export class CustomerController {
  constructor(private readonly svc: CustomerService) {}

  @Get('overview') overview(@CurrentUser() u: AuthUser) { return this.svc.overview(u.id); }
  @Patch('profile') updateProfile(@CurrentUser() u: AuthUser, @Body() dto: UpdateProfileDto) { return this.svc.updateProfile(u.id, dto); }

  @Get('addresses') addresses(@CurrentUser() u: AuthUser) { return this.svc.addresses(u.id); }
  @Post('addresses') createAddress(@CurrentUser() u: AuthUser, @Body() dto: AddressDto) { return this.svc.createAddress(u.id, dto); }
  @Put('addresses/:id') updateAddress(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: AddressDto) {
    return this.svc.updateAddress(u.id, id, dto);
  }
  @Delete('addresses/:id') deleteAddress(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.svc.deleteAddress(u.id, id); }

  @Get('orders') orders(@CurrentUser() u: AuthUser, @Query() q: PaginationQuery) { return this.svc.orders(u.id, q); }
  @Get('orders/:number') order(@CurrentUser() u: AuthUser, @Param('number') n: string) { return this.svc.order(u.id, n); }
  @Post('orders/:number/cancel') @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('number') n: string, @Body() dto: CancelDto) { return this.svc.cancel(u.id, n, dto.reason); }

  @Get('wishlist') wishlist(@CurrentUser() u: AuthUser) { return this.svc.wishlist(u.id); }
  @Get('wishlist/ids') wishlistIds(@CurrentUser() u: AuthUser) { return this.svc.wishlistIds(u.id); }
  @Post('wishlist/items') addWishlist(@CurrentUser() u: AuthUser, @Body() dto: WishlistAddDto) { return this.svc.addToWishlist(u.id, dto.productId); }
  @Delete('wishlist/items/:productId') removeWishlist(@CurrentUser() u: AuthUser, @Param('productId', ParseIntPipe) id: number) {
    return this.svc.removeFromWishlist(u.id, id);
  }
}

@ApiTags('Marketing')
@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly svc: CustomerService) {}

  @Public()
  @Post('subscribe')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  subscribe(@Body() dto: NewsletterDto) {
    return this.svc.subscribe(dto.email);
  }
}

@Module({ controllers: [CustomerController, NewsletterController], providers: [CustomerService] })
export class CustomerModule {}
