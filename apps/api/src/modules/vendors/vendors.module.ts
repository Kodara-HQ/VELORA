import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseIntPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ApplicationStatus, CommissionStatus, Prisma, SettlementStatus, VendorStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { GHANA_REGIONS, PERMISSIONS, type AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';
import { requestContext } from '../../common/utils/request';
import type { RequestContext } from '../../common/types';
import { AuditService } from '../audit/audit.module';
import { NotificationsService } from '../notifications/notifications.module';
import { slugify } from '../admin/admin-products.service';
import { vendorStats } from './vendor-stats';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blank = ({ value }: { value: unknown }) => (typeof value === 'string' && !value.trim() ? undefined : typeof value === 'string' ? value.trim() : value);
const DAY = 86_400_000;

// ─── DTOs ───

class ApplyDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2, { message: 'Enter your business name' }) @MaxLength(150) businessName: string;
  @ApiPropertyOptional({ description: 'Registrar-General registration number' }) @IsOptional() @Transform(blank) @Matches(/^[A-Z0-9-]{4,30}$/i, { message: 'Enter a valid registration number, e.g. CS123456789' }) registrationNumber?: string;
  @ApiPropertyOptional({ description: 'Ghana Card / TIN' }) @IsOptional() @Transform(blank) @Matches(/^[A-Z0-9-]{6,30}$/i, { message: 'Enter a valid TIN or Ghana Card number' }) taxId?: string;
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') : value)) @Matches(/^\+233[2-5]\d{8}$/, { message: 'Enter a Ghana mobile number like +233241234567' }) contactPhone: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(5, { message: 'Enter your business address' }) @MaxLength(255) businessAddress: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(60, { each: true }) productCategories: string[];
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsString() @MaxLength(1000) about?: string;
}

class ApplicationQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: ApplicationStatus }) @IsOptional() @IsEnum(ApplicationStatus) status?: ApplicationStatus;
}

class ReviewDto {
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsString() @MaxLength(1000) notes?: string;
  @ApiPropertyOptional({ description: 'Commission % for this vendor (default from settings)' }) @IsOptional() @IsNumber() @Min(0) @Max(50) commissionRate?: number;
}

class RejectDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(5, { message: 'Tell the applicant why' }) @MaxLength(1000) notes: string;
}

class VendorQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: VendorStatus }) @IsOptional() @IsEnum(VendorStatus) status?: VendorStatus;
}

class UpdateVendorDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(50) commissionRate?: number;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'] }) @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED']) status?: 'ACTIVE' | 'SUSPENDED';
  @ApiPropertyOptional() @IsOptional() @Transform(blank) @IsString() @MaxLength(255) reason?: string;
}

class SettlementQuery extends PaginationQuery {
  @ApiPropertyOptional({ enum: SettlementStatus }) @IsOptional() @IsEnum(SettlementStatus) status?: SettlementStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() vendorId?: number;
}

class GenerateDto {
  @ApiPropertyOptional({ description: 'Only this vendor (default: every vendor with payable earnings)' }) @IsOptional() @IsInt() vendorId?: number;
}

class PayDto {
  @ApiProperty() @Transform(trim) @Matches(/^[A-Za-z0-9._:/-]{4,100}$/, { message: 'Enter the MoMo or bank transfer reference' }) payoutReference: string;
}

// ─── Service ───

@Injectable()
export class VendorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // Public

  async publicProfile(slug: string) {
    const v = await this.prisma.vendor.findFirst({ where: { slug, status: VendorStatus.ACTIVE, deletedAt: null } });
    if (!v) throw new NotFoundException('Shop not found');
    const stats = (await vendorStats(this.prisma, [v.id], new Date(0))).get(v.id)!;
    return { name: v.businessName, slug: v.slug, description: v.description, logoUrl: v.logoUrl, since: v.verifiedAt ?? v.createdAt,
      rating: stats.rating, reviewCount: stats.reviewCount, productCount: stats.products.active };
  }

  // Applications (customer side)

  async apply(user: AuthUser, dto: ApplyDto, ctx: RequestContext) {
    if (await this.prisma.vendor.findFirst({ where: { ownerUserId: user.id, deletedAt: null } })) throw new ConflictException('You already have a VÉLORA shop');
    const open = await this.prisma.vendorApplication.findFirst({ where: { userId: user.id, status: { in: [ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_REVIEW] } } });
    if (open) throw new ConflictException('Your application is already being reviewed');
    const app = await this.prisma.vendorApplication.create({
      data: { userId: user.id, businessName: dto.businessName, registrationNumber: dto.registrationNumber?.toUpperCase(), taxId: dto.taxId?.toUpperCase(),
        contactPhone: dto.contactPhone, businessAddress: dto.businessAddress, productCategories: dto.productCategories,
        documents: dto.about ? { about: dto.about } : undefined },
    });
    await this.audit.log({ userId: user.id, action: 'vendor_applications.submitted', entityType: 'vendor_application', entityId: app.id, ctx });
    await this.notifications.notify(await this.notifications.staffWith(PERMISSIONS.VENDORS_APPROVE), {
      type: 'vendor.application', title: 'New vendor application', body: `${dto.businessName} applied to sell on VÉLORA.`, data: { href: `/admin/vendors/applications/${app.id}` },
    });
    return this.myApplication(user.id);
  }

  async myApplication(userId: number) {
    const [app, vendor] = await Promise.all([
      this.prisma.vendorApplication.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.vendor.findFirst({ where: { ownerUserId: userId, deletedAt: null }, select: { id: true, businessName: true, slug: true, status: true } }),
    ]);
    return { application: app && { id: app.id, businessName: app.businessName, status: app.status, reviewNotes: app.reviewNotes, createdAt: app.createdAt, reviewedAt: app.reviewedAt }, vendor };
  }

  // Applications (staff side)

  async applications(q: ApplicationQuery) {
    const where: Prisma.VendorApplicationWhereInput = {
      status: q.status,
      ...(q.q?.trim() && { OR: [{ businessName: { contains: q.q.trim() } }, { user: { email: { contains: q.q.trim() } } }] }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vendorApplication.findMany({ where, orderBy: { createdAt: q.order }, skip: q.skip, take: q.pageSize,
        include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true } }, reviewedBy: { select: { firstName: true, lastName: true } } } }),
      this.prisma.vendorApplication.count({ where }),
    ]);
    return new Paginated(rows, total, q);
  }

  async application(id: number) {
    const a = await this.prisma.vendorApplication.findUnique({ where: { id },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true, customer: { select: { orderCount: true } } } }, reviewedBy: { select: { firstName: true, lastName: true } } } });
    if (!a) throw new NotFoundException('Application not found');
    return a;
  }

  async markUnderReview(staff: AuthUser, id: number, ctx: RequestContext) {
    const r = await this.prisma.vendorApplication.updateMany({ where: { id, status: ApplicationStatus.SUBMITTED }, data: { status: ApplicationStatus.UNDER_REVIEW, reviewedById: staff.id } });
    if (r.count !== 1) throw new ConflictException('Only new applications can be moved to review');
    await this.audit.log({ userId: staff.id, action: 'vendor_applications.under_review', entityType: 'vendor_application', entityId: id, ctx });
    return this.application(id);
  }

  /** Approval creates the shop, its stock location and the vendor role, in one transaction. */
  async approve(staff: AuthUser, id: number, dto: ReviewDto, ctx: RequestContext) {
    const app = await this.application(id);
    if (app.status !== ApplicationStatus.SUBMITTED && app.status !== ApplicationStatus.UNDER_REVIEW) throw new ConflictException('This application was already decided');
    if (await this.prisma.vendor.findFirst({ where: { ownerUserId: app.userId, deletedAt: null } })) throw new ConflictException('This applicant already has a shop');
    const setting = await this.prisma.systemSetting.findUnique({ where: { group_key: { group: 'marketplace', key: 'defaultCommissionRate' } } });
    const rate = new Prisma.Decimal(dto.commissionRate ?? Number(setting?.value ?? 15));
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: 'vendor' } });
    let slug = slugify(app.businessName) || 'shop';
    for (let n = 2; await this.prisma.vendor.findUnique({ where: { slug } }); n++) slug = `${slugify(app.businessName)}-${n}`;

    const vendor = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.vendorApplication.updateMany({ where: { id, status: { in: [ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_REVIEW] } },
        data: { status: ApplicationStatus.APPROVED, reviewedById: staff.id, reviewedAt: new Date(), reviewNotes: dto.notes } });
      if (claimed.count !== 1) throw new ConflictException('This application was just decided by someone else');
      const v = await tx.vendor.create({
        data: { ownerUserId: app.userId, businessName: app.businessName, slug, email: app.user.email, phone: app.contactPhone, status: VendorStatus.ACTIVE,
          commissionRate: rate, verifiedAt: new Date(), description: (app.documents as { about?: string } | null)?.about },
      });
      const region = GHANA_REGIONS.find((r) => app.businessAddress.toLowerCase().includes(r.toLowerCase().split(' ')[0]));
      await tx.warehouse.create({ data: { code: `VND-${v.id}`, name: `${app.businessName} (vendor stock)`, vendorId: v.id, address: app.businessAddress, region, phone: app.contactPhone } });
      await tx.userRole.upsert({ where: { userId_roleId: { userId: app.userId, roleId: role.id } }, create: { userId: app.userId, roleId: role.id, assignedBy: staff.id }, update: {} });
      await this.audit.log({ userId: staff.id, action: 'vendor_applications.approved', entityType: 'vendor_application', entityId: id, newValues: { vendorId: v.id, slug, commissionRate: rate.toFixed(2) }, ctx }, tx);
      await this.notifications.notify(app.userId, {
        type: 'vendor.approved', title: 'Welcome to VÉLORA Marketplace', body: `${app.businessName} is approved. Add your first products in the vendor portal; each one is reviewed before it goes live.`, data: { href: '/vendor' },
      }, tx);
      return v;
    });
    return { application: await this.application(id), vendor: { id: vendor.id, slug: vendor.slug } };
  }

  async reject(staff: AuthUser, id: number, notes: string, ctx: RequestContext) {
    const app = await this.application(id);
    const r = await this.prisma.vendorApplication.updateMany({ where: { id, status: { in: [ApplicationStatus.SUBMITTED, ApplicationStatus.UNDER_REVIEW] } },
      data: { status: ApplicationStatus.REJECTED, reviewedById: staff.id, reviewedAt: new Date(), reviewNotes: notes } });
    if (r.count !== 1) throw new ConflictException('This application was already decided');
    await this.audit.log({ userId: staff.id, action: 'vendor_applications.rejected', entityType: 'vendor_application', entityId: id, newValues: { notes }, ctx });
    await this.notifications.notify(app.userId, { type: 'vendor.rejected', title: 'Your VÉLORA seller application', body: `We can’t approve ${app.businessName} right now: ${notes}`, data: { href: '/sell' } });
    return this.application(id);
  }

  // Vendors (staff side)

  async vendors(q: VendorQuery) {
    const where: Prisma.VendorWhereInput = {
      deletedAt: null, status: q.status,
      ...(q.q?.trim() && { OR: [{ businessName: { contains: q.q.trim() } }, { email: { contains: q.q.trim() } }] }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vendor.findMany({ where, orderBy: { createdAt: q.order }, skip: q.skip, take: q.pageSize,
        include: { owner: { select: { firstName: true, lastName: true, email: true } } } }),
      this.prisma.vendor.count({ where }),
    ]);
    const stats = await vendorStats(this.prisma, rows.map((r) => r.id), new Date(Date.now() - 90 * DAY));
    return new Paginated(rows.map((v) => ({
      id: v.id, businessName: v.businessName, slug: v.slug, email: v.email, phone: v.phone, status: v.status, commissionRate: v.commissionRate.toFixed(2),
      verifiedAt: v.verifiedAt, createdAt: v.createdAt, owner: v.owner, stats90d: stats.get(v.id),
    })), total, q);
  }

  async vendor(id: number) {
    const v = await this.prisma.vendor.findFirst({ where: { id, deletedAt: null },
      include: { owner: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } }, warehouses: { select: { id: true, code: true, name: true } } } });
    if (!v) throw new NotFoundException('Vendor not found');
    const [all, last90, settlements, topProducts] = await Promise.all([
      vendorStats(this.prisma, [id], new Date(0)),
      vendorStats(this.prisma, [id], new Date(Date.now() - 90 * DAY)),
      this.prisma.vendorSettlement.findMany({ where: { vendorId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.product.findMany({ where: { vendorId: id, deletedAt: null }, orderBy: { soldCount: 'desc' }, take: 10,
        select: { id: true, name: true, status: true, soldCount: true, avgRating: true, basePrice: true } }),
    ]);
    return {
      id: v.id, businessName: v.businessName, slug: v.slug, email: v.email, phone: v.phone, description: v.description, logoUrl: v.logoUrl,
      status: v.status, commissionRate: v.commissionRate.toFixed(2), payoutMethod: v.payoutMethod, payoutDetails: v.payoutDetails,
      verifiedAt: v.verifiedAt, createdAt: v.createdAt, owner: v.owner, warehouses: v.warehouses,
      stats: { allTime: all.get(id), last90Days: last90.get(id) },
      settlements: settlements.map((s) => ({ ...s, grossAmount: s.grossAmount.toFixed(2), commissionAmount: s.commissionAmount.toFixed(2), netAmount: s.netAmount.toFixed(2), adjustments: s.adjustments.toFixed(2) })),
      topProducts: topProducts.map((p) => ({ ...p, basePrice: p.basePrice.toFixed(2), avgRating: Number(p.avgRating) })),
    };
  }

  async updateVendor(staff: AuthUser, id: number, dto: UpdateVendorDto, ctx: RequestContext) {
    const v = await this.prisma.vendor.findFirst({ where: { id, deletedAt: null } });
    if (!v) throw new NotFoundException('Vendor not found');
    if (dto.status === 'SUSPENDED' && !dto.reason) throw new BadRequestException({ message: 'Give a reason for suspending this vendor', code: 'VALIDATION_FAILED', details: [{ field: 'reason', messages: ['Required when suspending'] }] });
    await this.prisma.vendor.update({ where: { id }, data: { commissionRate: dto.commissionRate != null ? new Prisma.Decimal(dto.commissionRate) : undefined, status: dto.status } });
    await this.audit.log({ userId: staff.id, action: 'vendors.updated', entityType: 'vendor', entityId: id,
      oldValues: { status: v.status, commissionRate: v.commissionRate.toFixed(2) }, newValues: { ...dto }, ctx });
    if (dto.status && dto.status !== v.status) {
      await this.notifications.notify(v.ownerUserId, dto.status === 'SUSPENDED'
        ? { type: 'vendor.suspended', title: 'Your shop is suspended', body: `Your products are hidden from the store. Reason: ${dto.reason}. Contact vendors@velora.test.` }
        : { type: 'vendor.reactivated', title: 'Your shop is live again', body: 'Your active products are visible in the store again.', data: { href: '/vendor' } });
    }
    if (dto.commissionRate != null && !v.commissionRate.eq(dto.commissionRate)) {
      await this.notifications.notify(v.ownerUserId, { type: 'vendor.commission', title: 'Commission rate updated', body: `Your commission is now ${dto.commissionRate}% on new orders.` });
    }
    return this.vendor(id);
  }

  // Settlements

  async payablePreview() {
    const rows = await this.prisma.$queryRaw<Array<{ vendor_id: number; lines: bigint; gross: Prisma.Decimal; commission: Prisma.Decimal; net: Prisma.Decimal; oldest: Date }>>`
      SELECT vendor_id, COUNT(*) AS lines, SUM(gross_amount) AS gross, SUM(commission_amount) AS commission, SUM(net_amount) AS net, MIN(eligible_at) AS oldest
      FROM vendor_commissions WHERE status = 'ELIGIBLE' AND eligible_at <= NOW() AND settlement_id IS NULL GROUP BY vendor_id`;
    const vendors = await this.prisma.vendor.findMany({ where: { id: { in: rows.map((r) => Number(r.vendor_id)) } }, select: { id: true, businessName: true, payoutMethod: true, status: true } });
    return rows.map((r) => {
      const v = vendors.find((x) => x.id === Number(r.vendor_id));
      return { vendorId: Number(r.vendor_id), vendor: v?.businessName, vendorStatus: v?.status, payoutMethod: v?.payoutMethod, lines: Number(r.lines),
        gross: Number(r.gross).toFixed(2), commission: Number(r.commission).toFixed(2), net: Number(r.net).toFixed(2), oldest: r.oldest };
    });
  }

  /** Bundles every payable (past-hold, unsettled) commission line into one draft statement per vendor. */
  async generate(staff: AuthUser, dto: GenerateDto, ctx: RequestContext) {
    const now = new Date();
    const vendorIds = dto.vendorId ? [dto.vendorId] : (await this.payablePreview()).map((p) => p.vendorId);
    const created: string[] = [];
    for (const vendorId of vendorIds) {
      await this.prisma.$transaction(async (tx) => {
        const lines = await tx.vendorCommission.findMany({
          where: { vendorId, status: CommissionStatus.ELIGIBLE, eligibleAt: { lte: now }, settlementId: null },
          include: { orderItem: { select: { createdAt: true } } },
        });
        if (!lines.length) return;
        const sum = (k: 'grossAmount' | 'commissionAmount' | 'netAmount') => lines.reduce((s, l) => s.add(l[k]), new Prisma.Decimal(0));
        const dates = lines.map((l) => l.orderItem.createdAt.getTime());
        const s = await tx.vendorSettlement.create({
          data: {
            vendorId, reference: `ST-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`,
            periodStart: new Date(Math.min(...dates)), periodEnd: new Date(Math.max(...dates)),
            grossAmount: sum('grossAmount'), commissionAmount: sum('commissionAmount'), netAmount: sum('netAmount'), status: SettlementStatus.DRAFT,
          },
        });
        // Conditional link: a line can only ever be claimed by one statement.
        const linked = await tx.vendorCommission.updateMany({ where: { id: { in: lines.map((l) => l.id) }, settlementId: null, status: CommissionStatus.ELIGIBLE }, data: { settlementId: s.id } });
        if (linked.count !== lines.length) throw new ConflictException('Earnings changed while generating. Please try again.');
        await this.audit.log({ userId: staff.id, action: 'settlements.generated', entityType: 'vendor_settlement', entityId: s.reference, newValues: { vendorId, lines: lines.length, net: s.netAmount.toFixed(2) }, ctx }, tx);
        created.push(s.reference);
      });
    }
    return { created };
  }

  async settlements(q: SettlementQuery) {
    const where: Prisma.VendorSettlementWhereInput = { status: q.status, vendorId: q.vendorId, ...(q.q?.trim() && { OR: [{ reference: { contains: q.q.trim().toUpperCase() } }, { vendor: { businessName: { contains: q.q.trim() } } }] }) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.vendorSettlement.findMany({ where, orderBy: { createdAt: q.order }, skip: q.skip, take: q.pageSize,
        include: { vendor: { select: { id: true, businessName: true, payoutMethod: true, payoutDetails: true } }, _count: { select: { commissions: true } } } }),
      this.prisma.vendorSettlement.count({ where }),
    ]);
    return new Paginated(rows.map(({ _count, ...s }) => ({ ...s, lines: _count.commissions, grossAmount: s.grossAmount.toFixed(2), commissionAmount: s.commissionAmount.toFixed(2), netAmount: s.netAmount.toFixed(2), adjustments: s.adjustments.toFixed(2) })), total, q);
  }

  async settlement(id: number, vendorId?: number) {
    const s = await this.prisma.vendorSettlement.findFirst({ where: { id, ...(vendorId && { vendorId }) },
      include: { vendor: { select: { id: true, businessName: true, payoutMethod: true, payoutDetails: true } },
        commissions: { orderBy: { createdAt: 'asc' }, include: { orderItem: { select: { productName: true, variantLabel: true, sku: true, quantity: true, order: { select: { orderNumber: true, placedAt: true } } } } } } } });
    if (!s) throw new NotFoundException('Settlement not found');
    return {
      ...s, grossAmount: s.grossAmount.toFixed(2), commissionAmount: s.commissionAmount.toFixed(2), netAmount: s.netAmount.toFixed(2), adjustments: s.adjustments.toFixed(2),
      commissions: s.commissions.map((c) => ({ id: c.id, rate: c.rate.toFixed(2), grossAmount: c.grossAmount.toFixed(2), commissionAmount: c.commissionAmount.toFixed(2), netAmount: c.netAmount.toFixed(2),
        orderNumber: c.orderItem.order.orderNumber, placedAt: c.orderItem.order.placedAt, product: c.orderItem.productName, variant: c.orderItem.variantLabel, sku: c.orderItem.sku, quantity: c.orderItem.quantity })),
    };
  }

  async approveSettlement(staff: AuthUser, id: number, ctx: RequestContext) {
    const r = await this.prisma.vendorSettlement.updateMany({ where: { id, status: SettlementStatus.DRAFT }, data: { status: SettlementStatus.APPROVED, approvedBy: staff.id } });
    if (r.count !== 1) throw new ConflictException('Only draft statements can be approved');
    await this.audit.log({ userId: staff.id, action: 'settlements.approved', entityType: 'vendor_settlement', entityId: id, ctx });
    return this.settlement(id);
  }

  async paySettlement(staff: AuthUser, id: number, ref: string, ctx: RequestContext) {
    const s = await this.prisma.vendorSettlement.findUnique({ where: { id }, include: { vendor: true } });
    if (!s) throw new NotFoundException('Settlement not found');
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.vendorSettlement.updateMany({ where: { id, status: SettlementStatus.APPROVED }, data: { status: SettlementStatus.PAID, paidAt: new Date(), payoutReference: ref } });
      if (r.count !== 1) throw new ConflictException('Approve the statement before recording payment');
      await tx.vendorCommission.updateMany({ where: { settlementId: id }, data: { status: CommissionStatus.SETTLED } });
      await this.audit.log({ userId: staff.id, action: 'settlements.paid', entityType: 'vendor_settlement', entityId: s.reference, newValues: { payoutReference: ref, net: s.netAmount.toFixed(2) }, ctx }, tx);
      await this.notifications.notify(s.vendor.ownerUserId, { type: 'vendor.payout', title: `Payout of GH₵${s.netAmount.toFixed(2)} sent`, body: `Statement ${s.reference} was paid (reference ${ref}).`, data: { href: `/vendor/payouts/${id}` } }, tx);
    });
    return this.settlement(id);
  }

  async cancelSettlement(staff: AuthUser, id: number, ctx: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const s = await tx.vendorSettlement.findUnique({ where: { id } });
      if (!s || (s.status !== SettlementStatus.DRAFT && s.status !== SettlementStatus.APPROVED)) throw new ConflictException('Only unpaid statements can be cancelled');
      await tx.vendorCommission.updateMany({ where: { settlementId: id }, data: { settlementId: null } });
      await tx.vendorSettlement.delete({ where: { id } });
      await this.audit.log({ userId: staff.id, action: 'settlements.cancelled', entityType: 'vendor_settlement', entityId: s.reference, ctx }, tx);
    });
    return { cancelled: true };
  }
}

// ─── Controllers ───

@ApiTags('Marketplace')
@Controller()
export class VendorsPublicController {
  constructor(private readonly svc: VendorsService) {}

  @Public() @Get('vendors/:slug')
  profile(@Param('slug') slug: string) { return this.svc.publicProfile(slug); }

  @ApiBearerAuth() @Get('me/vendor-application')
  mine(@CurrentUser() u: AuthUser) { return this.svc.myApplication(u.id); }

  @ApiBearerAuth() @Post('me/vendor-application')
  apply(@CurrentUser() u: AuthUser, @Body() dto: ApplyDto, @Req() r: Request) { return this.svc.apply(u, dto, requestContext(r)); }
}

@ApiTags('Admin · Vendors')
@ApiBearerAuth()
@Controller('admin')
export class AdminVendorsController {
  constructor(private readonly svc: VendorsService) {}

  @Get('vendor-applications') @RequirePermissions(PERMISSIONS.VENDORS_VIEW)
  applications(@Query() q: ApplicationQuery) { return this.svc.applications(q); }

  @Get('vendor-applications/:id') @RequirePermissions(PERMISSIONS.VENDORS_VIEW)
  application(@Param('id', ParseIntPipe) id: number) { return this.svc.application(id); }

  @Post('vendor-applications/:id/review') @HttpCode(200) @RequirePermissions(PERMISSIONS.VENDORS_APPROVE)
  review(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.markUnderReview(u, id, requestContext(r)); }

  @Post('vendor-applications/:id/approve') @HttpCode(200) @RequirePermissions(PERMISSIONS.VENDORS_APPROVE)
  approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ReviewDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.approve(u, id, dto, requestContext(r)); }

  @Post('vendor-applications/:id/reject') @HttpCode(200) @RequirePermissions(PERMISSIONS.VENDORS_APPROVE)
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.reject(u, id, dto.notes, requestContext(r)); }

  @Get('vendors') @RequirePermissions(PERMISSIONS.VENDORS_VIEW)
  vendors(@Query() q: VendorQuery) { return this.svc.vendors(q); }

  @Get('vendors/:id') @RequirePermissions(PERMISSIONS.VENDORS_VIEW)
  vendor(@Param('id', ParseIntPipe) id: number) { return this.svc.vendor(id); }

  @Patch('vendors/:id') @RequirePermissions(PERMISSIONS.VENDORS_MANAGE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVendorDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.updateVendor(u, id, dto, requestContext(r)); }

  @Get('settlements/payable') @RequirePermissions(PERMISSIONS.SETTLEMENTS_MANAGE)
  payable() { return this.svc.payablePreview(); }

  @Post('settlements/generate') @HttpCode(200) @RequirePermissions(PERMISSIONS.SETTLEMENTS_MANAGE)
  generate(@Body() dto: GenerateDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.generate(u, dto, requestContext(r)); }

  @Get('settlements') @RequirePermissions(PERMISSIONS.SETTLEMENTS_MANAGE)
  settlements(@Query() q: SettlementQuery) { return this.svc.settlements(q); }

  @Get('settlements/:id') @RequirePermissions(PERMISSIONS.SETTLEMENTS_MANAGE)
  settlement(@Param('id', ParseIntPipe) id: number) { return this.svc.settlement(id); }

  @Post('settlements/:id/approve') @HttpCode(200) @RequirePermissions(PERMISSIONS.SETTLEMENTS_MANAGE)
  approveSettlement(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.approveSettlement(u, id, requestContext(r)); }

  @Post('settlements/:id/pay') @HttpCode(200) @RequirePermissions(PERMISSIONS.SETTLEMENTS_MANAGE)
  pay(@Param('id', ParseIntPipe) id: number, @Body() dto: PayDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.paySettlement(u, id, dto.payoutReference, requestContext(r)); }

  @Post('settlements/:id/cancel') @HttpCode(200) @RequirePermissions(PERMISSIONS.SETTLEMENTS_MANAGE)
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.cancelSettlement(u, id, requestContext(r)); }
}

@Module({ controllers: [VendorsPublicController, AdminVendorsController], providers: [VendorsService], exports: [VendorsService] })
export class VendorsModule {}
