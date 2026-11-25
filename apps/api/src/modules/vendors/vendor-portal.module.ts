import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { CommissionStatus, OrderStatus, Prisma, ProductStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, NotEquals, ValidateNested } from 'class-validator';
import type { Request, Response } from 'express';
import { PERMISSIONS, type AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';
import { requestContext } from '../../common/utils/request';
import type { RequestContext } from '../../common/types';
import { AuditService } from '../audit/audit.module';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationsService } from '../notifications/notifications.module';
import { MAX_UPLOAD_BYTES, StorageService } from '../uploads/uploads.module';
import { AdminCatalogModule } from '../admin/admin-catalog.module';
import { AdminProductsService } from '../admin/admin-products.service';
import { AdminProductQuery, ProductInput } from '../admin/admin-products.dto';
import { DateRangeQuery, resolveRange, sendCsv } from '../admin/admin-common';
import { VendorsModule, VendorsService } from './vendors.module';
import { vendorStats } from './vendor-stats';

const blank = ({ value }: { value: unknown }) => (typeof value === 'string' && !value.trim() ? undefined : typeof value === 'string' ? value.trim() : value);
const DAY = 86_400_000;
const money = (v: unknown) => Number(v ?? 0).toFixed(2);

// ─── DTOs ───

class PayoutDetails {
  @ApiProperty() @Transform(blank) @IsString() @MinLength(2) @MaxLength(120) accountName: string;
  @ApiProperty({ description: 'MoMo number (+233…) or bank account number' }) @Transform(blank) @Matches(/^\+?\d{9,20}$/, { message: 'Enter the MoMo or account number' }) number: string;
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsString() @MaxLength(120) bankName?: string;
}

class ProfileDto {
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsUrl({ require_tld: false }) @MaxLength(512) logoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') : value)) @Matches(/^\+233[2-5]\d{8}$/, { message: 'Enter a Ghana mobile number like +233241234567' }) phone?: string;
  @ApiPropertyOptional({ enum: ['MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AT', 'BANK'] }) @IsOptional() @IsIn(['MOMO_MTN', 'MOMO_TELECEL', 'MOMO_AT', 'BANK']) payoutMethod?: string;
  @ApiPropertyOptional({ type: PayoutDetails }) @IsOptional() @ValidateNested() @Type(() => PayoutDetails) payoutDetails?: PayoutDetails;
}

class AdjustDto {
  @ApiProperty() @IsInt() variantId: number;
  @ApiProperty() @IsInt() @NotEquals(0) @Min(-10000) @Max(10000) delta: number;
  @ApiProperty() @Transform(blank) @IsString() @MinLength(3, { message: 'Add a short note, e.g. "New stock from workshop"' }) @MaxLength(255) note: string;
}

class OrderQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ['to_prepare', 'shipped', 'delivered', 'cancelled'] }) @IsOptional() @IsIn(['to_prepare', 'shipped', 'delivered', 'cancelled']) view?: string;
}

class EarningsQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: CommissionStatus }) @IsOptional() @IsIn(Object.values(CommissionStatus)) status?: CommissionStatus;
}

class ReportQuery extends DateRangeQuery {
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'] }) @IsOptional() @IsIn(['day', 'week', 'month']) groupBy: 'day' | 'week' | 'month' = 'week';
  @ApiPropertyOptional({ enum: ['json', 'csv'] }) @IsOptional() @IsIn(['json', 'csv']) format: 'json' | 'csv' = 'json';
}

/** Statuses a vendor may choose. ACTIVE is only ever set by VÉLORA staff after review. */
const VENDOR_STATUSES: ProductStatus[] = [ProductStatus.DRAFT, ProductStatus.PENDING_REVIEW, ProductStatus.ARCHIVED];

// ─── Service ───

@Injectable()
export class VendorPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: AdminProductsService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly vendors: VendorsService,
  ) {}

  /** The only source of the vendor scope: the authenticated principal. Never a request parameter. */
  vid(user: AuthUser) {
    if (!user.vendorId) throw new ForbiddenException('Your shop is not active');
    return user.vendorId;
  }

  private async ownProduct(vendorId: number, productId: number) {
    const p = await this.prisma.product.findFirst({ where: { id: productId, vendorId, deletedAt: null } });
    if (!p) throw new NotFoundException('Product not found'); // 404, not 403: don't reveal other shops' products
    return p;
  }

  private async ownWarehouseIds(vendorId: number) {
    return (await this.prisma.warehouse.findMany({ where: { vendorId, deletedAt: null }, select: { id: true } })).map((w) => w.id);
  }

  async dashboard(user: AuthUser) {
    const vendorId = this.vid(user);
    const since = new Date(Date.now() - 30 * DAY);
    const [stats, vendor, recent, series, lowStock] = await Promise.all([
      vendorStats(this.prisma, [vendorId], since),
      this.prisma.vendor.findUniqueOrThrow({ where: { id: vendorId }, select: { businessName: true, slug: true, commissionRate: true, payoutMethod: true } }),
      this.prisma.orderItem.findMany({
        where: { vendorId, order: { status: { notIn: [OrderStatus.PENDING_PAYMENT] } } }, orderBy: { createdAt: 'desc' }, take: 8,
        select: { id: true, productName: true, variantLabel: true, quantity: true, lineTotal: true, createdAt: true, order: { select: { orderNumber: true, status: true } } },
      }),
      this.prisma.$queryRaw<Array<{ d: Date; net: Prisma.Decimal; units: bigint }>>`
        SELECT DATE(o.placed_at) AS d, SUM(oi.line_total) AS net, SUM(oi.quantity) AS units FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.vendor_id = ${vendorId} AND o.status NOT IN ('CANCELLED','PENDING_PAYMENT') AND o.placed_at >= ${since}
        GROUP BY DATE(o.placed_at) ORDER BY d`,
      this.prisma.$queryRaw<Array<{ variant_id: number; sku: string; name: string; available: bigint }>>`
        SELECT v.id AS variant_id, v.sku, p.name, SUM(i.quantity_on_hand - i.quantity_reserved) AS available
        FROM product_variants v JOIN products p ON p.id = v.product_id JOIN inventory i ON i.variant_id = v.id
        WHERE p.vendor_id = ${vendorId} AND p.deleted_at IS NULL AND v.is_active = 1 AND v.deleted_at IS NULL AND p.status = 'ACTIVE'
        GROUP BY v.id, v.sku, p.name HAVING available <= 3 ORDER BY available LIMIT 8`,
    ]);
    const byDay = new Map(series.map((s) => [new Date(s.d).toISOString().slice(0, 10), s]));
    return {
      vendor: { ...vendor, commissionRate: vendor.commissionRate.toFixed(2) },
      last30Days: stats.get(vendorId),
      series: Array.from({ length: 30 }, (_, i) => {
        const day = new Date(Date.now() - (29 - i) * DAY).toISOString().slice(0, 10);
        return { date: day, revenue: money(byDay.get(day)?.net), orders: Number(byDay.get(day)?.units ?? 0) };
      }),
      recentSales: recent.map((r) => ({ ...r, lineTotal: r.lineTotal.toFixed(2) })),
      lowStock: lowStock.map((l) => ({ variantId: Number(l.variant_id), sku: l.sku, name: l.name, available: Number(l.available) })),
    };
  }

  // Profile

  async profile(user: AuthUser) {
    const v = await this.prisma.vendor.findUniqueOrThrow({ where: { id: this.vid(user) } });
    return { businessName: v.businessName, slug: v.slug, email: v.email, phone: v.phone, description: v.description, logoUrl: v.logoUrl,
      commissionRate: v.commissionRate.toFixed(2), payoutMethod: v.payoutMethod, payoutDetails: v.payoutDetails, verifiedAt: v.verifiedAt };
  }

  async updateProfile(user: AuthUser, dto: ProfileDto, ctx: RequestContext) {
    const vendorId = this.vid(user);
    if (dto.payoutMethod && !dto.payoutDetails) throw new BadRequestException('Add the account name and number for payouts');
    await this.prisma.vendor.update({ where: { id: vendorId }, data: {
      description: dto.description, logoUrl: dto.logoUrl, phone: dto.phone, payoutMethod: dto.payoutMethod,
      payoutDetails: dto.payoutDetails ? { ...dto.payoutDetails } : undefined,
    } });
    // Payout destination changes are security-sensitive: always audited.
    await this.audit.log({ userId: user.id, action: dto.payoutDetails ? 'vendor.payout_details_changed' : 'vendor.profile_updated', entityType: 'vendor', entityId: vendorId,
      newValues: { payoutMethod: dto.payoutMethod, payoutNumberEnding: dto.payoutDetails?.number.slice(-4) }, ctx });
    return this.profile(user);
  }

  // Products (submitted for review; never published directly)

  listProducts(user: AuthUser, q: AdminProductQuery) {
    return this.products.list(Object.assign(q, { owner: String(this.vid(user)) }));
  }

  async getProduct(user: AuthUser, id: number) {
    await this.ownProduct(this.vid(user), id);
    return this.products.get(id);
  }

  private async scrub(vendorId: number, dto: ProductInput, current?: { status: ProductStatus }) {
    const own = await this.ownWarehouseIds(vendorId);
    const requested = dto.status && VENDOR_STATUSES.includes(dto.status) ? dto.status : ProductStatus.PENDING_REVIEW;
    // Any change to a live product goes back to review, so nothing unreviewed is ever on sale.
    const status = current?.status === ProductStatus.ACTIVE && requested !== ProductStatus.ARCHIVED ? ProductStatus.PENDING_REVIEW : requested;
    return {
      ...dto, vendorId, status, isFeatured: false,
      variants: dto.variants?.map((v) => ({ ...v, stock: v.stock?.filter((s) => own.includes(s.warehouseId)) })),
    } as ProductInput;
  }

  async createProduct(user: AuthUser, dto: ProductInput, ctx: RequestContext) {
    const vendorId = this.vid(user);
    const p = await this.products.create(user, await this.scrub(vendorId, dto), ctx);
    if (p.status === ProductStatus.PENDING_REVIEW) await this.notifyReview(p.name, p.id);
    return p;
  }

  async updateProduct(user: AuthUser, id: number, dto: ProductInput, ctx: RequestContext) {
    const vendorId = this.vid(user);
    const current = await this.ownProduct(vendorId, id);
    const p = await this.products.update(user, id, await this.scrub(vendorId, dto, current), ctx);
    if (p.status === ProductStatus.PENDING_REVIEW) await this.notifyReview(p.name, p.id);
    return p;
  }

  async archiveProduct(user: AuthUser, id: number, ctx: RequestContext) {
    await this.ownProduct(this.vid(user), id);
    return this.products.setStatus(user, id, ProductStatus.ARCHIVED, ctx);
  }

  private async notifyReview(name: string, id: number) {
    await this.notifications.notify(await this.notifications.staffWith(PERMISSIONS.PRODUCTS_APPROVE), {
      type: 'product.review', title: 'Vendor product to review', body: `“${name}” was submitted for review.`, data: { href: `/admin/products/${id}` },
    });
  }

  warehouses(user: AuthUser) {
    return this.prisma.warehouse.findMany({ where: { vendorId: this.vid(user), deletedAt: null }, select: { id: true, code: true, name: true } });
  }

  async upload(user: AuthUser, files: Express.Multer.File[] | undefined, storage: StorageService) {
    this.vid(user);
    if (!files?.length) throw new BadRequestException('Choose at least one image');
    const out = [];
    for (const f of files) out.push(await storage.putImage(f.buffer, 'products'));
    return out;
  }

  // Inventory

  async stock(user: AuthUser, q: PaginationQuery) {
    const vendorId = this.vid(user);
    const where: Prisma.ProductVariantWhereInput = {
      deletedAt: null, product: { vendorId, deletedAt: null },
      ...(q.q?.trim() && { OR: [{ sku: { contains: q.q.trim().toUpperCase() } }, { product: { name: { contains: q.q.trim() } } }] }),
    };
    const own = await this.ownWarehouseIds(vendorId);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productVariant.findMany({ where, skip: q.skip, take: q.pageSize, orderBy: [{ product: { name: 'asc' } }, { sortOrder: 'asc' }],
        include: { product: { select: { id: true, name: true, status: true } }, inventory: { include: { warehouse: { select: { id: true, code: true, vendorId: true } } } } } }),
      this.prisma.productVariant.count({ where }),
    ]);
    return new Paginated(rows.map((v) => ({
      variantId: v.id, sku: v.sku, label: [v.color, v.size].filter(Boolean).join(' / '), isActive: v.isActive, product: v.product,
      onHand: v.inventory.reduce((s, i) => s + i.quantityOnHand, 0), reserved: v.inventory.reduce((s, i) => s + i.quantityReserved, 0),
      available: v.inventory.reduce((s, i) => s + i.quantityOnHand - i.quantityReserved, 0),
      // Stock held at VÉLORA warehouses (consignment) is shown read-only; vendors adjust only their own location.
      locations: v.inventory.filter((i) => i.quantityOnHand > 0 || own.includes(i.warehouseId)).map((i) => ({
        warehouse: i.warehouse.code, own: own.includes(i.warehouseId), onHand: i.quantityOnHand, reserved: i.quantityReserved })),
    })), total, q);
  }

  async adjust(user: AuthUser, dto: AdjustDto, ctx: RequestContext) {
    const vendorId = this.vid(user);
    const v = await this.prisma.productVariant.findFirst({ where: { id: dto.variantId, deletedAt: null, product: { vendorId } } });
    if (!v) throw new NotFoundException('Variant not found');
    const [warehouseId] = await this.ownWarehouseIds(vendorId);
    if (!warehouseId) throw new BadRequestException('Your shop has no stock location. Contact VÉLORA.');
    return this.prisma.$transaction(async (tx) => {
      const r = await this.inventory.adjust(tx, { variantId: v.id, warehouseId, delta: dto.delta, type: 'ADJUSTMENT', note: `Vendor: ${dto.note}`, userId: user.id });
      await this.audit.log({ userId: user.id, action: 'vendor.inventory_adjusted', entityType: 'inventory', entityId: r.inventoryId, newValues: { sku: v.sku, delta: dto.delta, note: dto.note }, ctx }, tx);
      return r;
    });
  }

  // Orders: only this vendor's lines, and only what's needed to prepare them (no customer contact details).

  private orderWhere(vendorId: number, view?: string): Prisma.OrderWhereInput {
    const status: Prisma.OrderWhereInput['status'] =
      view === 'to_prepare' ? { in: [OrderStatus.PAID, OrderStatus.PROCESSING] }
      : view === 'shipped' ? { in: [OrderStatus.SHIPPED, OrderStatus.PARTIALLY_SHIPPED] }
      : view === 'delivered' ? { in: [OrderStatus.DELIVERED, OrderStatus.COMPLETED, OrderStatus.PARTIALLY_REFUNDED, OrderStatus.REFUNDED] }
      : view === 'cancelled' ? OrderStatus.CANCELLED
      : { notIn: [OrderStatus.PENDING_PAYMENT] };
    return { items: { some: { vendorId } }, status };
  }

  private presentOrder(vendorId: number, o: Prisma.OrderGetPayload<{ include: { items: { include: { commission: true } } } }>) {
    const lines = o.items.filter((i) => i.vendorId === vendorId);
    const a = o.shippingAddress as { recipientName?: string; city?: string; region?: string } | null;
    const sum = (f: (i: (typeof lines)[number]) => Prisma.Decimal | null | undefined) => lines.reduce((s, i) => s.add(f(i) ?? 0), new Prisma.Decimal(0)).toFixed(2);
    return {
      orderNumber: o.orderNumber, status: o.status, placedAt: o.placedAt,
      customer: { firstName: (a?.recipientName ?? 'Customer').split(' ')[0], city: a?.city ?? null, region: a?.region ?? null },
      lines: lines.map((i) => ({ id: i.id, name: i.productName, variantLabel: i.variantLabel, sku: i.sku, image: i.imageUrl, quantity: i.quantity,
        quantityReturned: i.quantityReturned, lineTotal: i.lineTotal.toFixed(2), commission: i.commission?.commissionAmount.toFixed(2) ?? '0.00',
        net: i.commission?.netAmount.toFixed(2) ?? i.lineTotal.toFixed(2), earningStatus: i.commission?.status ?? null })),
      totals: { gross: sum((i) => i.lineTotal), commission: sum((i) => i.commission?.commissionAmount), net: sum((i) => i.commission?.netAmount ?? i.lineTotal) },
    };
  }

  async orders(user: AuthUser, q: OrderQuery) {
    const vendorId = this.vid(user);
    const where: Prisma.OrderWhereInput = { ...this.orderWhere(vendorId, q.view), ...(q.q?.trim() && { orderNumber: { contains: q.q.trim().toUpperCase() } }) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, orderBy: { placedAt: 'desc' }, skip: q.skip, take: q.pageSize, include: { items: { include: { commission: true } } } }),
      this.prisma.order.count({ where }),
    ]);
    return new Paginated(rows.map((o) => this.presentOrder(vendorId, o)), total, q);
  }

  async order(user: AuthUser, orderNumber: string) {
    const vendorId = this.vid(user);
    const o = await this.prisma.order.findFirst({ where: { orderNumber, ...this.orderWhere(vendorId) }, include: { items: { include: { commission: true } } } });
    if (!o) throw new NotFoundException('Order not found');
    return this.presentOrder(vendorId, o);
  }

  // Money

  async earnings(user: AuthUser, q: EarningsQuery) {
    const vendorId = this.vid(user);
    const where: Prisma.VendorCommissionWhereInput = { vendorId, status: q.status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vendorCommission.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize,
        include: { orderItem: { select: { productName: true, variantLabel: true, quantity: true, order: { select: { orderNumber: true, placedAt: true } } } }, settlement: { select: { id: true, reference: true } } } }),
      this.prisma.vendorCommission.count({ where }),
    ]);
    const summary = (await vendorStats(this.prisma, [vendorId], new Date(0))).get(vendorId)!.earnings;
    const page = new Paginated(rows.map((c) => ({
      id: c.id, status: c.status, rate: c.rate.toFixed(2), grossAmount: c.grossAmount.toFixed(2), commissionAmount: c.commissionAmount.toFixed(2), netAmount: c.netAmount.toFixed(2),
      eligibleAt: c.eligibleAt, settlement: c.settlement, orderNumber: c.orderItem.order.orderNumber, placedAt: c.orderItem.order.placedAt,
      product: c.orderItem.productName, variant: c.orderItem.variantLabel, quantity: c.orderItem.quantity,
    })), total, q);
    return { items: page.items, meta: page.meta, summary };
  }

  async settlements(user: AuthUser) {
    const rows = await this.prisma.vendorSettlement.findMany({ where: { vendorId: this.vid(user) }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { commissions: true } } } });
    return rows.map(({ _count, ...s }) => ({ ...s, lines: _count.commissions, grossAmount: s.grossAmount.toFixed(2), commissionAmount: s.commissionAmount.toFixed(2), netAmount: s.netAmount.toFixed(2), adjustments: s.adjustments.toFixed(2) }));
  }

  settlement(user: AuthUser, id: number) {
    return this.vendors.settlement(id, this.vid(user));
  }

  async salesReport(user: AuthUser, q: ReportQuery) {
    const vendorId = this.vid(user);
    const { from, to } = resolveRange(q);
    const bucket = q.groupBy === 'month' ? Prisma.sql`DATE_FORMAT(o.placed_at, '%Y-%m')`
      : q.groupBy === 'week' ? Prisma.sql`DATE_FORMAT(DATE_SUB(DATE(o.placed_at), INTERVAL WEEKDAY(o.placed_at) DAY), '%Y-%m-%d')`
      : Prisma.sql`DATE_FORMAT(o.placed_at, '%Y-%m-%d')`;
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${bucket} AS period, COUNT(DISTINCT o.id) AS orders, SUM(oi.quantity) AS units, SUM(oi.quantity_returned) AS returned,
             SUM(oi.line_total) AS gross, COALESCE(SUM(vc.commission_amount), 0) AS commission, COALESCE(SUM(vc.net_amount), 0) AS net
      FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN vendor_commissions vc ON vc.order_item_id = oi.id AND vc.status <> 'REVERSED'
      WHERE oi.vendor_id = ${vendorId} AND o.status NOT IN ('CANCELLED','PENDING_PAYMENT') AND o.placed_at >= ${from} AND o.placed_at < ${to}
      GROUP BY period ORDER BY period`;
    return {
      groupBy: q.groupBy,
      rows: rows.map((r) => ({ period: String(r.period), orders: Number(r.orders), units: Number(r.units), returned: Number(r.returned ?? 0), gross: money(r.gross), commission: money(r.commission), net: money(r.net) })),
    };
  }

  async reviews(user: AuthUser, q: PaginationQuery) {
    const where: Prisma.ProductReviewWhereInput = { product: { vendorId: this.vid(user) }, status: 'APPROVED' };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize,
        select: { id: true, rating: true, title: true, body: true, fit: true, createdAt: true, isVerifiedBuyer: true,
          user: { select: { firstName: true, lastName: true } }, product: { select: { id: true, name: true, slug: true } } } }),
      this.prisma.productReview.count({ where }),
    ]);
    return new Paginated(rows.map(({ user: u, ...r }) => ({ ...r, author: `${u.firstName} ${u.lastName.charAt(0)}.` })), total, q);
  }
}

// ─── Controller ───

@ApiTags('Vendor portal')
@ApiBearerAuth()
@RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS)
@Controller('vendor')
export class VendorPortalController {
  constructor(
    private readonly svc: VendorPortalService,
    private readonly storage: StorageService,
  ) {}

  @Get('dashboard') dashboard(@CurrentUser() u: AuthUser) { return this.svc.dashboard(u); }
  @Get('profile') profile(@CurrentUser() u: AuthUser) { return this.svc.profile(u); }
  @Patch('profile') updateProfile(@CurrentUser() u: AuthUser, @Body() dto: ProfileDto, @Req() r: Request) { return this.svc.updateProfile(u, dto, requestContext(r)); }

  @Get('products') products(@CurrentUser() u: AuthUser, @Query() q: AdminProductQuery) { return this.svc.listProducts(u, q); }
  @Get('products/:id') product(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.svc.getProduct(u, id); }

  @Post('products') @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS, PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  create(@CurrentUser() u: AuthUser, @Body() dto: ProductInput, @Req() r: Request) { return this.svc.createProduct(u, dto, requestContext(r)); }

  @Put('products/:id') @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS, PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  update(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ProductInput, @Req() r: Request) { return this.svc.updateProduct(u, id, dto, requestContext(r)); }

  @Post('products/:id/archive') @HttpCode(200) @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS, PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  archive(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Req() r: Request) { return this.svc.archiveProduct(u, id, requestContext(r)); }

  @Get('warehouses') warehouses(@CurrentUser() u: AuthUser) { return this.svc.warehouses(u); }

  @Post('uploads/images') @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS, PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 } }))
  upload(@CurrentUser() u: AuthUser, @UploadedFiles() files: Express.Multer.File[] | undefined) { return this.svc.upload(u, files, this.storage); }

  @Get('inventory') stock(@CurrentUser() u: AuthUser, @Query() q: PaginationQuery) { return this.svc.stock(u, q); }
  @Post('inventory/adjust') @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS, PERMISSIONS.VENDOR_PRODUCTS_MANAGE)
  adjust(@CurrentUser() u: AuthUser, @Body() dto: AdjustDto, @Req() r: Request) { return this.svc.adjust(u, dto, requestContext(r)); }

  @Get('orders') @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS, PERMISSIONS.VENDOR_ORDERS_VIEW)
  orders(@CurrentUser() u: AuthUser, @Query() q: OrderQuery) { return this.svc.orders(u, q); }
  @Get('orders/:number') @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS, PERMISSIONS.VENDOR_ORDERS_VIEW)
  order(@CurrentUser() u: AuthUser, @Param('number') n: string) { return this.svc.order(u, n); }

  @Get('earnings') @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS, PERMISSIONS.VENDOR_REPORTS_VIEW)
  earnings(@CurrentUser() u: AuthUser, @Query() q: EarningsQuery) { return this.svc.earnings(u, q); }
  @Get('settlements') @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS, PERMISSIONS.VENDOR_REPORTS_VIEW)
  settlements(@CurrentUser() u: AuthUser) { return this.svc.settlements(u); }
  @Get('settlements/:id') @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS, PERMISSIONS.VENDOR_REPORTS_VIEW)
  settlement(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.svc.settlement(u, id); }

  @Get('reports/sales') @RequirePermissions(PERMISSIONS.VENDOR_PORTAL_ACCESS, PERMISSIONS.VENDOR_REPORTS_VIEW)
  async sales(@CurrentUser() u: AuthUser, @Query() q: ReportQuery, @Res({ passthrough: true }) res: Response) {
    const r = await this.svc.salesReport(u, q);
    if (q.format !== 'csv') return r;
    return sendCsv(res, `velora-vendor-sales-${q.groupBy}.csv`, ['Period', 'Orders', 'Units', 'Returned', 'Sales (GHS)', 'Commission (GHS)', 'Your earnings (GHS)'],
      r.rows.map((x) => [x.period, x.orders, x.units, x.returned, x.gross, x.commission, x.net]));
  }

  @Get('reviews') reviews(@CurrentUser() u: AuthUser, @Query() q: PaginationQuery) { return this.svc.reviews(u, q); }
}

@Module({ imports: [AdminCatalogModule, VendorsModule], controllers: [VendorPortalController], providers: [VendorPortalService] })
export class VendorPortalModule {}
