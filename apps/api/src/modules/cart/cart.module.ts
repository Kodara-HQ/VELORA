import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module,
  NotFoundException, Param, ParseIntPipe, Patch, Post,
} from '@nestjs/common';
import { ApiHeader, ApiProperty, ApiTags } from '@nestjs/swagger';
import { CartStatus, Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../../common/decorators';
import { GUEST_HEADER, requireViewer, Viewer, type ViewerRef } from '../../common/viewer';
import { cartItemInclude, fmt, MAX_QTY_PER_LINE, PricingService, type PricedLine } from './pricing.service';

class AddItemDto {
  @ApiProperty() @IsInt() @Min(1) variantId: number;
  @ApiProperty({ minimum: 1, maximum: MAX_QTY_PER_LINE }) @IsInt() @Min(1) @Max(MAX_QTY_PER_LINE) quantity: number;
}

class UpdateItemDto {
  @ApiProperty({ minimum: 1, maximum: MAX_QTY_PER_LINE }) @IsInt() @Min(1) @Max(MAX_QTY_PER_LINE) quantity: number;
}

class CouponDto {
  @ApiProperty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString() @MaxLength(40) @Matches(/^[A-Z0-9_-]+$/, { message: 'Enter a valid code' })
  code: string;
}

const cartInclude = { items: { include: cartItemInclude, orderBy: { addedAt: 'asc' } }, coupon: true } satisfies Prisma.CartInclude;
export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

export const presentLine = (l: PricedLine) => ({
  id: l.itemId, variantId: l.variantId, productId: l.productId, slug: l.slug, name: l.name, brand: l.brand,
  image: l.image, sku: l.sku, color: l.color, size: l.size, variantLabel: l.variantLabel,
  unitPrice: fmt(l.unitPrice), compareAtPrice: fmt(l.compareAtPrice), quantity: l.quantity,
  available: Math.min(l.available, MAX_QTY_PER_LINE), lineTotal: fmt(l.lineTotal), issue: l.issue,
});

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  private ownerWhere(v: ViewerRef): Prisma.CartWhereInput {
    return v.userId ? { userId: v.userId, status: CartStatus.ACTIVE } : { guestToken: v.guestId, userId: null, status: CartStatus.ACTIVE };
  }

  async find(v: ViewerRef): Promise<CartWithItems | null> {
    if (!v.userId && !v.guestId) return null;
    return this.prisma.cart.findFirst({ where: this.ownerWhere(v), include: cartInclude, orderBy: { updatedAt: 'desc' } });
  }

  private async findOrCreate(v: ViewerRef) {
    requireViewer(v);
    const existing = await this.find(v);
    if (existing) return existing;
    return this.prisma.cart.create({
      data: v.userId ? { userId: v.userId } : { guestToken: v.guestId },
      include: cartInclude,
    });
  }

  /** Full priced view of the cart. Coupon validity is re-checked every time. */
  async view(v: ViewerRef) {
    const cart = await this.find(v);
    if (!cart) return this.empty();
    const lines = cart.items.map((i) => this.pricing.priceLine(i));
    const subtotal = this.pricing.subtotal(lines);
    let coupon = null;
    let discount = new Prisma.Decimal(0);
    if (cart.coupon) {
      const r = await this.pricing.evaluateCoupon(cart.coupon, { subtotal, userId: v.userId, email: v.email });
      discount = r.discount;
      coupon = { code: r.coupon.code, description: r.coupon.description, type: r.coupon.type, valid: r.valid, reason: r.reason, discount: fmt(r.discount), freeShipping: r.freeShipping };
    }
    const totals = await this.pricing.totals(subtotal, discount, new Prisma.Decimal(0));
    return {
      id: cart.id,
      currency: cart.currency,
      items: lines.map(presentLine),
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
      coupon,
      subtotal: fmt(totals.subtotal),
      discountTotal: fmt(totals.discountTotal),
      taxTotal: fmt(totals.taxTotal),
      estimatedTotal: fmt(totals.grandTotal),
      hasIssues: lines.some((l) => l.issue),
    };
  }

  private empty() {
    return { id: null, currency: 'GHS', items: [], itemCount: 0, coupon: null, subtotal: '0.00', discountTotal: '0.00', taxTotal: '0.00', estimatedTotal: '0.00', hasIssues: false };
  }

  async addItem(v: ViewerRef, dto: AddItemDto) {
    const cart = await this.findOrCreate(v);
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: dto.variantId, isActive: true, deletedAt: null, product: this.pricing.isVisibleWhere() },
      include: { inventory: { select: { quantityOnHand: true, quantityReserved: true, warehouse: { select: { isActive: true } } } } },
    });
    if (!variant) throw new NotFoundException('This item is no longer available');
    const available = variant.inventory.filter((i) => i.warehouse.isActive).reduce((s, i) => s + Math.max(0, i.quantityOnHand - i.quantityReserved), 0);
    if (available === 0) throw new ConflictException({ message: 'Sorry, this size is sold out', code: 'OUT_OF_STOCK' });

    const existing = cart.items.find((i) => i.variantId === variant.id);
    const wanted = (existing?.quantity ?? 0) + dto.quantity;
    const quantity = Math.min(wanted, available, MAX_QTY_PER_LINE);
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
      create: { cartId: cart.id, variantId: variant.id, quantity },
      update: { quantity },
    });
    await this.touch(cart.id);
    const view = await this.view(v);
    return { ...view, notice: quantity < wanted ? `Only ${quantity} available — we've added the maximum.` : null };
  }

  async updateItem(v: ViewerRef, itemId: number, quantity: number) {
    const cart = await this.ownedCartWithItem(v, itemId);
    const line = this.pricing.priceLine(cart.items.find((i) => i.id === itemId)!);
    if (line.issue === 'UNAVAILABLE') throw new ConflictException('This item is no longer available. Please remove it.');
    const capped = Math.min(quantity, Math.max(line.available, 1), MAX_QTY_PER_LINE);
    await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity: capped } });
    await this.touch(cart.id);
    const view = await this.view(v);
    return { ...view, notice: capped < quantity ? `Only ${capped} available.` : null };
  }

  async removeItem(v: ViewerRef, itemId: number) {
    const cart = await this.ownedCartWithItem(v, itemId);
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    await this.touch(cart.id);
    return this.view(v);
  }

  async applyCoupon(v: ViewerRef, code: string) {
    const cart = await this.find(v);
    if (!cart || !cart.items.length) throw new BadRequestException('Add something to your bag before using a code');
    const coupon = await this.pricing.findCoupon(code);
    if (!coupon) throw new BadRequestException({ message: "We don't recognise that code", code: 'COUPON_INVALID' });
    const subtotal = this.pricing.subtotal(cart.items.map((i) => this.pricing.priceLine(i)));
    const r = await this.pricing.evaluateCoupon(coupon, { subtotal, userId: v.userId, email: v.email });
    if (!r.valid) throw new BadRequestException({ message: r.reason, code: 'COUPON_INVALID' });
    await this.prisma.cart.update({ where: { id: cart.id }, data: { couponId: coupon.id } });
    return this.view(v);
  }

  async removeCoupon(v: ViewerRef) {
    const cart = await this.find(v);
    if (cart) await this.prisma.cart.update({ where: { id: cart.id }, data: { couponId: null } });
    return this.view(v);
  }

  /** Called on sign-in: moves a guest's bag into the user's bag (quantities combined, capped by stock). */
  async mergeGuestCart(userId: number, guestId: string | null) {
    if (!guestId) return;
    const guest = await this.find({ userId: null, guestId, email: null });
    if (!guest || !guest.items.length) return;
    const user = await this.findOrCreate({ userId, guestId: null, email: null });
    await this.prisma.$transaction(async (tx) => {
      for (const item of guest.items) {
        const line = this.pricing.priceLine(item);
        if (line.issue === 'UNAVAILABLE' || line.available === 0) continue;
        const current = user.items.find((i) => i.variantId === item.variantId)?.quantity ?? 0;
        const quantity = Math.min(current + item.quantity, line.available, MAX_QTY_PER_LINE);
        await tx.cartItem.upsert({
          where: { cartId_variantId: { cartId: user.id, variantId: item.variantId } },
          create: { cartId: user.id, variantId: item.variantId, quantity },
          update: { quantity },
        });
      }
      await tx.cart.update({ where: { id: guest.id }, data: { status: CartStatus.MERGED } });
      if (!user.couponId && guest.couponId) await tx.cart.update({ where: { id: user.id }, data: { couponId: guest.couponId } });
    });
  }

  private async ownedCartWithItem(v: ViewerRef, itemId: number) {
    const cart = await this.find(v);
    if (!cart || !cart.items.some((i) => i.id === itemId)) throw new NotFoundException('That item is not in your bag');
    return cart;
  }

  private touch(cartId: number) {
    return this.prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date(), abandonedNotifiedAt: null } });
  }
}

@ApiTags('Cart')
@ApiHeader({ name: GUEST_HEADER, required: false, description: 'Random id identifying a guest shopper' })
@Public()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@Viewer() v: ViewerRef) {
    return this.cart.view(v);
  }

  @Post('items')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  add(@Viewer() v: ViewerRef, @Body() dto: AddItemDto) {
    return this.cart.addItem(v, dto);
  }

  @Patch('items/:id')
  update(@Viewer() v: ViewerRef, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateItemDto) {
    return this.cart.updateItem(v, id, dto.quantity);
  }

  @Delete('items/:id')
  remove(@Viewer() v: ViewerRef, @Param('id', ParseIntPipe) id: number) {
    return this.cart.removeItem(v, id);
  }

  @Post('coupon')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  applyCoupon(@Viewer() v: ViewerRef, @Body() dto: CouponDto) {
    return this.cart.applyCoupon(v, dto.code);
  }

  @Delete('coupon')
  removeCoupon(@Viewer() v: ViewerRef) {
    return this.cart.removeCoupon(v);
  }
}

@Module({ controllers: [CartController], providers: [CartService, PricingService], exports: [CartService, PricingService] })
export class CartModule {}
