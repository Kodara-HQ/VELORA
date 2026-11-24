import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseIntPipe, Patch, Post, Query, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma, PurchaseOrderStatus, StockMovementType, TransferStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, NotEquals, ValidateNested,
} from 'class-validator';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { GHANA_REGIONS, PERMISSIONS, type AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { Paginated, PaginationQuery } from '../../common/dto/pagination.dto';
import { requestContext } from '../../common/utils/request';
import type { RequestContext } from '../../common/types';
import { AuditService } from '../audit/audit.module';
import { InventoryService } from '../inventory/inventory.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndef = ({ value }: { value: unknown }) => (typeof value === 'string' && !value.trim() ? undefined : typeof value === 'string' ? value.trim() : value);
const ref = (prefix: string) => `${prefix}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${randomBytes(2).toString('hex').toUpperCase()}`;

// ─── DTOs ───

class StockQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() warehouseId?: number;
  @ApiPropertyOptional({ enum: ['low', 'out'] }) @IsOptional() @IsIn(['low', 'out']) stock?: 'low' | 'out';
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) override pageSize = 50;
}

class AdjustDto {
  @ApiProperty() @IsInt() variantId: number;
  @ApiProperty() @IsInt() warehouseId: number;
  @ApiProperty({ description: 'Signed change, e.g. -2 or 10' }) @IsInt() @NotEquals(0, { message: 'Enter a change other than zero' }) @Min(-100000) @Max(100000) delta: number;
  @ApiProperty({ enum: ['ADJUSTMENT', 'DAMAGE'] }) @IsIn(['ADJUSTMENT', 'DAMAGE']) type: 'ADJUSTMENT' | 'DAMAGE';
  @ApiProperty() @Transform(trim) @IsString() @MinLength(3, { message: 'Explain the adjustment (e.g. "Stock count 24 Nov")' }) @MaxLength(255) note: string;
}

class InventorySettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10000) reorderLevel?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(40) binLocation?: string;
}

class MovementQuery extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() variantId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() warehouseId?: number;
  @ApiPropertyOptional({ enum: StockMovementType }) @IsOptional() @IsEnum(StockMovementType) type?: StockMovementType;
}

class WarehouseDto {
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^[A-Z0-9-]{2,20}$/, { message: 'Code like ACC-02' }) code: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(255) address?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(GHANA_REGIONS as unknown as string[]) region?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @Matches(/^\+?\d{9,15}$/) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

class LineDto {
  @ApiProperty() @IsInt() variantId: number;
  @ApiProperty() @IsInt() @Min(1) @Max(100000) quantity: number;
}

class TransferDto {
  @ApiProperty() @IsInt() fromWarehouseId: number;
  @ApiProperty() @IsInt() toWarehouseId: number;
  @ApiProperty({ type: [LineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => LineDto) items: LineDto[];
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(255) note?: string;
}

class SupplierDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(150) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(120) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsEmail() @MaxLength(191) email?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @Matches(/^\+?[\d\s-]{7,20}$/, { message: 'Enter a valid phone number' }) phone?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(255) address?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(60) country?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(100) paymentTerms?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

class PoLineDto extends LineDto {
  @ApiProperty() @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: 'Unit cost like 120.00' }) unitCost: string;
}

class PurchaseOrderDto {
  @ApiProperty() @IsInt() supplierId: number;
  @ApiProperty() @IsInt() warehouseId: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expectedAt?: string;
  @ApiProperty({ type: [PoLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => PoLineDto) items: PoLineDto[];
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(500) note?: string;
}

class ReceiveLineDto {
  @ApiProperty() @IsInt() purchaseOrderItemId: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100000) quantityReceived: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100000) quantityRejected?: number;
}

class ReceiveDto {
  @ApiProperty({ type: [ReceiveLineDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) items: ReceiveLineDto[];
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(500) note?: string;
}

class StatusFilter extends PaginationQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) status?: string;
}

// ─── Service ───

@Injectable()
export class AdminInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  /** One row per variant with a per-warehouse breakdown. */
  async stock(q: StockQuery) {
    const and: Prisma.ProductVariantWhereInput[] = [{ deletedAt: null, product: { deletedAt: null } }];
    if (q.q?.trim()) {
      const t = q.q.trim();
      and.push({ OR: [{ sku: { contains: t.toUpperCase() } }, { product: { name: { contains: t } } }, { product: { styleCode: { contains: t.toUpperCase() } } }] });
    }
    if (q.stock) {
      const rows = await this.prisma.$queryRaw<Array<{ variant_id: number }>>`
        SELECT i.variant_id FROM inventory i
        ${q.warehouseId ? Prisma.sql`WHERE i.warehouse_id = ${q.warehouseId}` : Prisma.empty}
        GROUP BY i.variant_id
        HAVING ${q.stock === 'out' ? Prisma.sql`SUM(i.quantity_on_hand - i.quantity_reserved) <= 0` : Prisma.sql`SUM(i.quantity_on_hand - i.quantity_reserved) <= MAX(i.reorder_level)`}`;
      and.push({ id: { in: rows.map((r) => Number(r.variant_id)) } });
    }
    const where: Prisma.ProductVariantWhereInput = { AND: and };
    const [rows, total, warehouses] = await Promise.all([
      this.prisma.productVariant.findMany({
        where, skip: q.skip, take: q.pageSize, orderBy: [{ product: { name: 'asc' } }, { sortOrder: 'asc' }],
        include: {
          product: { select: { id: true, name: true, styleCode: true, status: true, images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } } } },
          inventory: { where: q.warehouseId ? { warehouseId: q.warehouseId } : {}, orderBy: { warehouseId: 'asc' } },
        },
      }),
      this.prisma.productVariant.count({ where }),
      this.prisma.warehouse.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' }, select: { id: true, code: true, name: true, isActive: true } }),
    ]);
    const page = new Paginated(rows.map((v) => {
      const onHand = v.inventory.reduce((s, i) => s + i.quantityOnHand, 0);
      const reserved = v.inventory.reduce((s, i) => s + i.quantityReserved, 0);
      const reorder = Math.max(0, ...v.inventory.map((i) => i.reorderLevel));
      return {
        variantId: v.id, sku: v.sku, label: [v.color, v.size].filter(Boolean).join(' / '), isActive: v.isActive,
        product: { id: v.product.id, name: v.product.name, styleCode: v.product.styleCode, status: v.product.status, image: v.product.images[0]?.url ?? null },
        onHand, reserved, available: onHand - reserved, reorderLevel: reorder,
        state: onHand - reserved <= 0 ? 'out' : onHand - reserved <= reorder ? 'low' : 'ok',
        warehouses: v.inventory.map((i) => ({ inventoryId: i.id, warehouseId: i.warehouseId, onHand: i.quantityOnHand, reserved: i.quantityReserved,
          available: i.quantityOnHand - i.quantityReserved, reorderLevel: i.reorderLevel, binLocation: i.binLocation, averageCost: i.averageCost.toFixed(2) })),
      };
    }), total, q);
    return Object.assign(page, { warehouses });
  }

  async adjust(user: AuthUser, dto: AdjustDto, ctx: RequestContext) {
    const [variant, wh] = await Promise.all([
      this.prisma.productVariant.findFirst({ where: { id: dto.variantId, deletedAt: null }, select: { sku: true } }),
      this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, deletedAt: null }, select: { code: true } }),
    ]);
    if (!variant) throw new NotFoundException('Variant not found');
    if (!wh) throw new NotFoundException('Warehouse not found');
    if (dto.type === 'DAMAGE' && dto.delta > 0) throw new BadRequestException('Damage write-offs must reduce stock');
    return this.prisma.$transaction(async (tx) => {
      const r = await this.inventory.adjust(tx, { ...dto, userId: user.id });
      await this.audit.log({ userId: user.id, action: 'inventory.adjusted', entityType: 'inventory', entityId: r.inventoryId,
        newValues: { sku: variant.sku, warehouse: wh.code, delta: dto.delta, type: dto.type, note: dto.note, onHand: r.onHand }, ctx }, tx);
      return r;
    });
  }

  async updateSettings(user: AuthUser, inventoryId: number, dto: InventorySettingsDto, ctx: RequestContext) {
    const inv = await this.prisma.inventory.update({ where: { id: inventoryId }, data: { reorderLevel: dto.reorderLevel, binLocation: dto.binLocation ?? null } });
    await this.audit.log({ userId: user.id, action: 'inventory.settings', entityType: 'inventory', entityId: inventoryId, newValues: { ...dto }, ctx });
    return inv;
  }

  async movements(q: MovementQuery) {
    const where: Prisma.StockMovementWhereInput = {
      type: q.type,
      inventory: { ...(q.variantId && { variantId: q.variantId }), ...(q.warehouseId && { warehouseId: q.warehouseId }) },
      ...(q.q?.trim() && { inventory: { variant: { OR: [{ sku: { contains: q.q.trim().toUpperCase() } }, { product: { name: { contains: q.q.trim() } } }] } } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where, skip: q.skip, take: q.pageSize, orderBy: { createdAt: 'desc' },
        include: {
          inventory: { select: { warehouse: { select: { code: true } }, variant: { select: { sku: true, color: true, size: true, product: { select: { name: true } } } } } },
          user: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return new Paginated(rows.map((m) => ({
      id: m.id, type: m.type, quantity: m.quantity, balanceAfter: m.balanceAfter, unitCost: m.unitCost?.toFixed(2) ?? null,
      referenceType: m.referenceType, referenceId: m.referenceId, note: m.note, createdAt: m.createdAt,
      warehouse: m.inventory.warehouse.code, sku: m.inventory.variant.sku, product: m.inventory.variant.product.name,
      label: [m.inventory.variant.color, m.inventory.variant.size].filter(Boolean).join(' / '),
      by: m.user ? `${m.user.firstName} ${m.user.lastName}` : 'System',
    })), total, q);
  }

  /** Stock value at weighted-average cost, per warehouse. */
  async valuation() {
    const rows = await this.prisma.$queryRaw<Array<{ warehouse_id: number; code: string; name: string; units: bigint; value: Prisma.Decimal; retail: Prisma.Decimal; skus: bigint }>>`
      SELECT w.id AS warehouse_id, w.code, w.name,
             COALESCE(SUM(i.quantity_on_hand), 0) AS units,
             COALESCE(SUM(i.quantity_on_hand * i.average_cost), 0) AS value,
             COALESCE(SUM(i.quantity_on_hand * COALESCE(v.price, p.base_price)), 0) AS retail,
             COUNT(DISTINCT CASE WHEN i.quantity_on_hand > 0 THEN i.variant_id END) AS skus
      FROM warehouses w
      LEFT JOIN inventory i ON i.warehouse_id = w.id
      LEFT JOIN product_variants v ON v.id = i.variant_id AND v.deleted_at IS NULL
      LEFT JOIN products p ON p.id = v.product_id AND p.deleted_at IS NULL
      WHERE w.deleted_at IS NULL
      GROUP BY w.id, w.code, w.name ORDER BY w.id`;
    const list = rows.map((r) => ({ warehouseId: Number(r.warehouse_id), code: r.code, name: r.name, units: Number(r.units), skus: Number(r.skus),
      costValue: Number(r.value).toFixed(2), retailValue: Number(r.retail).toFixed(2) }));
    return {
      warehouses: list,
      totals: {
        units: list.reduce((s, r) => s + r.units, 0),
        costValue: list.reduce((s, r) => s + Number(r.costValue), 0).toFixed(2),
        retailValue: list.reduce((s, r) => s + Number(r.retailValue), 0).toFixed(2),
      },
    };
  }

  // ─── Warehouses ───

  warehouses() {
    return this.prisma.warehouse.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' }, include: { _count: { select: { inventory: true } } } });
  }

  async saveWarehouse(user: AuthUser, id: number | null, dto: WarehouseDto, ctx: RequestContext) {
    const clash = await this.prisma.warehouse.findFirst({ where: { code: dto.code, ...(id && { id: { not: id } }) } });
    if (clash) throw new ConflictException(`Code ${dto.code} is already used`);
    if (id && dto.isActive === false) {
      const reserved = await this.prisma.inventory.aggregate({ where: { warehouseId: id }, _sum: { quantityReserved: true } });
      if ((reserved._sum.quantityReserved ?? 0) > 0) throw new ConflictException('This warehouse has stock reserved for open orders. Fulfil or move them first.');
    }
    const w = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.warehouse.updateMany({ data: { isDefault: false } });
      const data = { ...dto, address: dto.address ?? null, city: dto.city ?? null, region: dto.region ?? null, phone: dto.phone ?? null };
      const saved = id ? await tx.warehouse.update({ where: { id }, data }) : await tx.warehouse.create({ data });
      if (!id) {
        // Every active variant gets a (zero) stock row in the new warehouse.
        const variants = await tx.productVariant.findMany({ where: { deletedAt: null }, select: { id: true } });
        if (variants.length) await tx.inventory.createMany({ data: variants.map((v) => ({ variantId: v.id, warehouseId: saved.id })), skipDuplicates: true });
      }
      return saved;
    });
    await this.audit.log({ userId: user.id, action: id ? 'warehouses.updated' : 'warehouses.created', entityType: 'warehouse', entityId: w.id, newValues: { ...dto }, ctx });
    return w;
  }

  // ─── Transfers ───

  async transfers(q: StatusFilter) {
    const where: Prisma.StockTransferWhereInput = q.status && q.status in TransferStatus ? { status: q.status as TransferStatus } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockTransfer.findMany({
        where, skip: q.skip, take: q.pageSize, orderBy: { createdAt: 'desc' },
        include: { fromWarehouse: { select: { code: true } }, toWarehouse: { select: { code: true } }, items: { include: { variant: { select: { sku: true, color: true, size: true, product: { select: { name: true } } } } } } },
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);
    return new Paginated(rows, total, q);
  }

  async createTransfer(user: AuthUser, dto: TransferDto, ctx: RequestContext) {
    if (dto.fromWarehouseId === dto.toWarehouseId) throw new BadRequestException('Choose two different warehouses');
    const ids = [...new Set(dto.items.map((i) => i.variantId))];
    if (ids.length !== dto.items.length) throw new BadRequestException('Each variant may appear only once');
    const found = await this.prisma.productVariant.count({ where: { id: { in: ids }, deletedAt: null } });
    if (found !== ids.length) throw new BadRequestException('One or more variants were not found');
    const t = await this.prisma.stockTransfer.create({
      data: { transferNumber: ref('TR'), fromWarehouseId: dto.fromWarehouseId, toWarehouseId: dto.toWarehouseId, note: dto.note, createdById: user.id,
        items: { create: dto.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })) } },
    });
    await this.audit.log({ userId: user.id, action: 'transfers.created', entityType: 'stock_transfer', entityId: t.id,
      newValues: { from: dto.fromWarehouseId, to: dto.toWarehouseId, items: dto.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })), note: dto.note ?? null }, ctx });
    return t;
  }

  async dispatchTransfer(user: AuthUser, id: number, ctx: RequestContext) {
    const t = await this.prisma.stockTransfer.findUnique({ where: { id }, include: { items: true } });
    if (!t) throw new NotFoundException('Transfer not found');
    if (t.status !== TransferStatus.DRAFT) throw new ConflictException('Only draft transfers can be dispatched');
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockTransfer.updateMany({ where: { id, status: TransferStatus.DRAFT }, data: { status: TransferStatus.IN_TRANSIT, shippedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException('Transfer already dispatched');
      for (const i of t.items) await this.inventory.transferLeg(tx, { variantId: i.variantId, warehouseId: t.fromWarehouseId, quantity: i.quantity, direction: 'out', transferId: id, userId: user.id });
      await this.audit.log({ userId: user.id, action: 'transfers.dispatched', entityType: 'stock_transfer', entityId: id, ctx }, tx);
    });
    return this.prisma.stockTransfer.findUnique({ where: { id } });
  }

  async receiveTransfer(user: AuthUser, id: number, ctx: RequestContext) {
    const t = await this.prisma.stockTransfer.findUnique({ where: { id }, include: { items: true } });
    if (!t) throw new NotFoundException('Transfer not found');
    if (t.status !== TransferStatus.IN_TRANSIT) throw new ConflictException('Only in-transit transfers can be received');
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockTransfer.updateMany({ where: { id, status: TransferStatus.IN_TRANSIT }, data: { status: TransferStatus.RECEIVED, receivedAt: new Date() } });
      if (claimed.count !== 1) throw new ConflictException('Transfer already received');
      for (const i of t.items) await this.inventory.transferLeg(tx, { variantId: i.variantId, warehouseId: t.toWarehouseId, quantity: i.quantity, direction: 'in', transferId: id, userId: user.id });
      await this.audit.log({ userId: user.id, action: 'transfers.received', entityType: 'stock_transfer', entityId: id, ctx }, tx);
    });
    return this.prisma.stockTransfer.findUnique({ where: { id } });
  }

  async cancelTransfer(user: AuthUser, id: number, ctx: RequestContext) {
    const claimed = await this.prisma.stockTransfer.updateMany({ where: { id, status: TransferStatus.DRAFT }, data: { status: TransferStatus.CANCELLED } });
    if (claimed.count !== 1) throw new ConflictException('Only draft transfers can be cancelled');
    await this.audit.log({ userId: user.id, action: 'transfers.cancelled', entityType: 'stock_transfer', entityId: id, ctx });
    return { cancelled: true };
  }

  // ─── Suppliers ───

  suppliers() {
    return this.prisma.supplier.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, include: { _count: { select: { purchaseOrders: true } } } });
  }

  async saveSupplier(user: AuthUser, id: number | null, dto: SupplierDto, ctx: RequestContext) {
    const data = { ...dto, contactName: dto.contactName ?? null, email: dto.email ?? null, phone: dto.phone ?? null, address: dto.address ?? null, country: dto.country ?? null, paymentTerms: dto.paymentTerms ?? null };
    const s = id ? await this.prisma.supplier.update({ where: { id }, data }) : await this.prisma.supplier.create({ data });
    await this.audit.log({ userId: user.id, action: id ? 'suppliers.updated' : 'suppliers.created', entityType: 'supplier', entityId: s.id, newValues: { ...dto }, ctx });
    return s;
  }

  // ─── Purchase orders & goods received ───

  private poInclude = {
    supplier: { select: { id: true, name: true } },
    warehouse: { select: { id: true, code: true, name: true } },
    items: { include: { variant: { select: { sku: true, color: true, size: true, product: { select: { name: true } } } } }, orderBy: { id: 'asc' } },
    receipts: { include: { items: true }, orderBy: { receivedAt: 'desc' } },
  } satisfies Prisma.PurchaseOrderInclude;

  async purchaseOrders(q: StatusFilter) {
    const where: Prisma.PurchaseOrderWhereInput = q.status && q.status in PurchaseOrderStatus ? { status: q.status as PurchaseOrderStatus } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({ where, skip: q.skip, take: q.pageSize, orderBy: { createdAt: 'desc' },
        include: { supplier: { select: { name: true } }, warehouse: { select: { code: true } }, items: { select: { quantityOrdered: true, quantityReceived: true } } } }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return new Paginated(rows.map(({ items, ...po }) => ({
      ...po, totalCost: po.totalCost.toFixed(2),
      ordered: items.reduce((s, i) => s + i.quantityOrdered, 0), received: items.reduce((s, i) => s + i.quantityReceived, 0),
    })), total, q);
  }

  async purchaseOrder(id: number) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: this.poInclude });
    if (!po) throw new NotFoundException('Purchase order not found');
    return { ...po, totalCost: po.totalCost.toFixed(2), items: po.items.map((i) => ({ ...i, unitCost: i.unitCost.toFixed(2) })) };
  }

  async createPurchaseOrder(user: AuthUser, dto: PurchaseOrderDto, ctx: RequestContext) {
    const ids = [...new Set(dto.items.map((i) => i.variantId))];
    if (ids.length !== dto.items.length) throw new BadRequestException('Each variant may appear only once');
    const [supplier, wh, found] = await Promise.all([
      this.prisma.supplier.findFirst({ where: { id: dto.supplierId, deletedAt: null, isActive: true } }),
      this.prisma.warehouse.findFirst({ where: { id: dto.warehouseId, deletedAt: null } }),
      this.prisma.productVariant.count({ where: { id: { in: ids }, deletedAt: null } }),
    ]);
    if (!supplier) throw new BadRequestException('Choose an active supplier');
    if (!wh) throw new BadRequestException('Choose a warehouse');
    if (found !== ids.length) throw new BadRequestException('One or more variants were not found');
    const total = dto.items.reduce((s, i) => s.add(new Prisma.Decimal(i.unitCost).mul(i.quantity)), new Prisma.Decimal(0));
    const po = await this.prisma.purchaseOrder.create({
      data: { poNumber: ref('PO'), supplierId: dto.supplierId, warehouseId: dto.warehouseId, totalCost: total, note: dto.note, createdById: user.id,
        expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
        items: { create: dto.items.map((i) => ({ variantId: i.variantId, quantityOrdered: i.quantity, unitCost: new Prisma.Decimal(i.unitCost) })) } },
    });
    await this.audit.log({ userId: user.id, action: 'purchase_orders.created', entityType: 'purchase_order', entityId: po.id, newValues: { poNumber: po.poNumber, total: total.toFixed(2) }, ctx });
    return this.purchaseOrder(po.id);
  }

  async markOrdered(user: AuthUser, id: number, ctx: RequestContext) {
    const claimed = await this.prisma.purchaseOrder.updateMany({ where: { id, status: PurchaseOrderStatus.DRAFT }, data: { status: PurchaseOrderStatus.ORDERED } });
    if (claimed.count !== 1) throw new ConflictException('Only draft purchase orders can be sent');
    await this.audit.log({ userId: user.id, action: 'purchase_orders.ordered', entityType: 'purchase_order', entityId: id, ctx });
    return this.purchaseOrder(id);
  }

  async cancelPurchaseOrder(user: AuthUser, id: number, ctx: RequestContext) {
    const claimed = await this.prisma.purchaseOrder.updateMany({ where: { id, status: { in: [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.ORDERED] } }, data: { status: PurchaseOrderStatus.CANCELLED } });
    if (claimed.count !== 1) throw new ConflictException('Purchase orders with received goods cannot be cancelled');
    await this.audit.log({ userId: user.id, action: 'purchase_orders.cancelled', entityType: 'purchase_order', entityId: id, ctx });
    return this.purchaseOrder(id);
  }

  /** Goods received note: adds accepted units to stock at the PO unit cost and advances the PO status. */
  async receive(user: AuthUser, id: number, dto: ReceiveDto, ctx: RequestContext) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status !== PurchaseOrderStatus.ORDERED && po.status !== PurchaseOrderStatus.PARTIALLY_RECEIVED) {
      throw new ConflictException('Send the purchase order to the supplier before receiving goods');
    }
    for (const r of dto.items) {
      const line = po.items.find((i) => i.id === r.purchaseOrderItemId);
      if (!line) throw new BadRequestException(`Line ${r.purchaseOrderItemId} is not on this purchase order`);
      if (line.quantityReceived + r.quantityReceived > line.quantityOrdered) {
        throw new BadRequestException(`Line ${line.id}: receiving ${r.quantityReceived} would exceed the ${line.quantityOrdered - line.quantityReceived} still outstanding`);
      }
    }
    if (!dto.items.some((i) => i.quantityReceived > 0)) throw new BadRequestException('Enter at least one received quantity');

    await this.prisma.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.create({
        data: { receiptNumber: ref('GRN'), purchaseOrderId: id, receivedById: user.id, note: dto.note,
          items: { create: dto.items.map((i) => ({ purchaseOrderItemId: i.purchaseOrderItemId, quantityReceived: i.quantityReceived, quantityRejected: i.quantityRejected ?? 0 })) } },
      });
      for (const r of dto.items) {
        if (!r.quantityReceived) continue;
        const line = po.items.find((i) => i.id === r.purchaseOrderItemId)!;
        const updated = await tx.purchaseOrderItem.updateMany({
          where: { id: line.id, quantityReceived: { lte: line.quantityOrdered - r.quantityReceived } },
          data: { quantityReceived: { increment: r.quantityReceived } },
        });
        if (updated.count !== 1) throw new ConflictException('This purchase order was received by someone else just now. Refresh and try again.');
        await this.inventory.receive(tx, { variantId: line.variantId, warehouseId: po.warehouseId, quantity: r.quantityReceived, unitCost: line.unitCost, referenceId: receipt.id, userId: user.id });
      }
      const lines = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
      const done = lines.every((l) => l.quantityReceived >= l.quantityOrdered);
      await tx.purchaseOrder.update({ where: { id }, data: { status: done ? PurchaseOrderStatus.RECEIVED : PurchaseOrderStatus.PARTIALLY_RECEIVED } });
      await this.audit.log({ userId: user.id, action: 'goods.received', entityType: 'purchase_order', entityId: id, newValues: { receipt: receipt.receiptNumber, lines: dto.items.length }, ctx }, tx);
    }, { timeout: 30_000 });
    return this.purchaseOrder(id);
  }
}

// ─── Controller ───

@ApiTags('Admin · Inventory')
@ApiBearerAuth()
@Controller('admin')
export class AdminInventoryController {
  constructor(private readonly svc: AdminInventoryService) {}

  @Get('inventory') @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  stock(@Query() q: StockQuery) { return this.svc.stock(q).then((p) => ({ items: p.items, meta: p.meta, warehouses: p.warehouses })); }

  @Get('inventory/valuation') @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  valuation() { return this.svc.valuation(); }

  @Post('inventory/adjust') @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  adjust(@Body() dto: AdjustDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.adjust(u, dto, requestContext(r)); }

  @Patch('inventory/:id') @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  settings(@Param('id', ParseIntPipe) id: number, @Body() dto: InventorySettingsDto, @CurrentUser() u: AuthUser, @Req() r: Request) {
    return this.svc.updateSettings(u, id, dto, requestContext(r));
  }

  @Get('stock-movements') @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  movements(@Query() q: MovementQuery) { return this.svc.movements(q); }

  @Get('warehouses') @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  warehouses() { return this.svc.warehouses(); }

  @Post('warehouses') @RequirePermissions(PERMISSIONS.WAREHOUSES_MANAGE)
  createWarehouse(@Body() dto: WarehouseDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.saveWarehouse(u, null, dto, requestContext(r)); }

  @Patch('warehouses/:id') @RequirePermissions(PERMISSIONS.WAREHOUSES_MANAGE)
  updateWarehouse(@Param('id', ParseIntPipe) id: number, @Body() dto: WarehouseDto, @CurrentUser() u: AuthUser, @Req() r: Request) {
    return this.svc.saveWarehouse(u, id, dto, requestContext(r));
  }

  @Get('stock-transfers') @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  transfers(@Query() q: StatusFilter) { return this.svc.transfers(q); }

  @Post('stock-transfers') @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  createTransfer(@Body() dto: TransferDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.createTransfer(u, dto, requestContext(r)); }

  @Post('stock-transfers/:id/dispatch') @HttpCode(200) @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  dispatch(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.dispatchTransfer(u, id, requestContext(r)); }

  @Post('stock-transfers/:id/receive') @HttpCode(200) @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  receiveTransfer(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.receiveTransfer(u, id, requestContext(r)); }

  @Post('stock-transfers/:id/cancel') @HttpCode(200) @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  cancelTransfer(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.cancelTransfer(u, id, requestContext(r)); }

  @Get('suppliers') @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  suppliers() { return this.svc.suppliers(); }

  @Post('suppliers') @RequirePermissions(PERMISSIONS.SUPPLIERS_MANAGE)
  createSupplier(@Body() dto: SupplierDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.saveSupplier(u, null, dto, requestContext(r)); }

  @Patch('suppliers/:id') @RequirePermissions(PERMISSIONS.SUPPLIERS_MANAGE)
  updateSupplier(@Param('id', ParseIntPipe) id: number, @Body() dto: SupplierDto, @CurrentUser() u: AuthUser, @Req() r: Request) {
    return this.svc.saveSupplier(u, id, dto, requestContext(r));
  }

  @Get('purchase-orders') @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  pos(@Query() q: StatusFilter) { return this.svc.purchaseOrders(q); }

  @Get('purchase-orders/:id') @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  po(@Param('id', ParseIntPipe) id: number) { return this.svc.purchaseOrder(id); }

  @Post('purchase-orders') @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_MANAGE)
  createPo(@Body() dto: PurchaseOrderDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.createPurchaseOrder(u, dto, requestContext(r)); }

  @Post('purchase-orders/:id/order') @HttpCode(200) @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_MANAGE)
  order(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.markOrdered(u, id, requestContext(r)); }

  @Post('purchase-orders/:id/cancel') @HttpCode(200) @RequirePermissions(PERMISSIONS.PURCHASE_ORDERS_MANAGE)
  cancelPo(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.cancelPurchaseOrder(u, id, requestContext(r)); }

  @Post('purchase-orders/:id/receive') @HttpCode(200) @RequirePermissions(PERMISSIONS.GOODS_RECEIVE)
  receive(@Param('id', ParseIntPipe) id: number, @Body() dto: ReceiveDto, @CurrentUser() u: AuthUser, @Req() r: Request) { return this.svc.receive(u, id, dto, requestContext(r)); }
}

@Module({ controllers: [AdminInventoryController], providers: [AdminInventoryService] })
export class AdminInventoryModule {}
