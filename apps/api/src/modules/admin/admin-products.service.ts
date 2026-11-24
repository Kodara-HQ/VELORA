import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductStatus, StockMovementType } from '@prisma/client';
import type { AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Paginated } from '../../common/dto/pagination.dto';
import type { RequestContext } from '../../common/types';
import { AuditService } from '../audit/audit.module';
import { CatalogService } from '../catalog/catalog.service';
import { parseCsv } from './admin-common';
import type { AdminProductQuery, ProductInput, VariantInput } from './admin-products.dto';

const D = (v: string) => new Prisma.Decimal(v);
export const slugify = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 200);
const skuPart = (s?: string | null) => (s ? slugify(s).replace(/-/g, '').slice(0, 12).toUpperCase() : '');

const detailInclude = {
  category: { select: { id: true, name: true, slug: true, parent: { select: { name: true } } } },
  brand: { select: { id: true, name: true } },
  vendor: { select: { id: true, businessName: true } },
  images: { orderBy: { sortOrder: 'asc' } },
  attributes: { orderBy: { sortOrder: 'asc' } },
  variants: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    include: { inventory: { include: { warehouse: { select: { id: true, code: true, name: true } } }, orderBy: { warehouseId: 'asc' } } },
  },
} satisfies Prisma.ProductInclude;

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
  ) {}

  async list(q: AdminProductQuery) {
    const and: Prisma.ProductWhereInput[] = [{ deletedAt: null }];
    if (q.status) and.push({ status: q.status });
    if (q.categoryId) and.push({ categoryId: { in: (await this.catalog.categoryTree()).byId.has(q.categoryId) ? await this.subtree(q.categoryId) : [q.categoryId] } });
    if (q.brandId) and.push({ brandId: q.brandId });
    if (q.owner === 'platform') and.push({ vendorId: null });
    else if (q.owner && /^\d+$/.test(q.owner)) and.push({ vendorId: Number(q.owner) });
    if (q.q?.trim()) {
      const t = q.q.trim();
      and.push({ OR: [{ name: { contains: t } }, { styleCode: { contains: t } }, { variants: { some: { sku: { contains: t } } } }] });
    }
    if (q.stock) {
      const rows = await this.prisma.$queryRaw<Array<{ product_id: number }>>`
        SELECT v.product_id FROM product_variants v LEFT JOIN inventory i ON i.variant_id = v.id
        WHERE v.is_active = 1 AND v.deleted_at IS NULL
        GROUP BY v.product_id
        HAVING ${q.stock === 'out'
          ? Prisma.sql`COALESCE(SUM(i.quantity_on_hand - i.quantity_reserved), 0) <= 0`
          : Prisma.sql`MIN(COALESCE(i.quantity_on_hand - i.quantity_reserved, 0)) <= MAX(COALESCE(i.reorder_level, 5))`}`;
      and.push({ id: { in: rows.map((r) => Number(r.product_id)) } });
    }
    const where: Prisma.ProductWhereInput = { AND: and };
    const orderBy: Prisma.ProductOrderByWithRelationInput =
      q.sort === 'name' ? { name: 'asc' } : q.sort === 'price' ? { basePrice: q.order } : q.sort === 'sold' ? { soldCount: 'desc' } : { updatedAt: 'desc' };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where, orderBy, skip: q.skip, take: q.pageSize,
        select: {
          id: true, name: true, slug: true, styleCode: true, status: true, basePrice: true, compareAtPrice: true, isFeatured: true,
          soldCount: true, updatedAt: true,
          category: { select: { name: true } }, brand: { select: { name: true } }, vendor: { select: { businessName: true } },
          images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } },
          variants: { where: { deletedAt: null }, select: { isActive: true, inventory: { select: { quantityOnHand: true, quantityReserved: true, reorderLevel: true } } } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return new Paginated(rows.map((p) => {
      const inv = p.variants.filter((v) => v.isActive).flatMap((v) => v.inventory);
      const onHand = inv.reduce((s, i) => s + i.quantityOnHand, 0);
      const available = inv.reduce((s, i) => s + i.quantityOnHand - i.quantityReserved, 0);
      return {
        id: p.id, name: p.name, slug: p.slug, styleCode: p.styleCode, status: p.status, isFeatured: p.isFeatured,
        price: p.basePrice.toFixed(2), compareAtPrice: p.compareAtPrice?.toFixed(2) ?? null, soldCount: p.soldCount, updatedAt: p.updatedAt,
        category: p.category.name, brand: p.brand?.name ?? null, vendor: p.vendor?.businessName ?? null, image: p.images[0]?.url ?? null,
        variantCount: p.variants.filter((v) => v.isActive).length, onHand, available,
      };
    }), total, q);
  }

  private async subtree(id: number) {
    const { byId } = await this.catalog.categoryTree();
    const out: number[] = [];
    const walk = (n: number) => { out.push(n); byId.get(n)?.children.forEach((c) => walk(c.id)); };
    walk(id);
    return out;
  }

  async get(id: number) {
    const p = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, include: detailInclude });
    if (!p) throw new NotFoundException('Product not found');
    return {
      ...p,
      basePrice: p.basePrice.toFixed(2), compareAtPrice: p.compareAtPrice?.toFixed(2) ?? null, avgRating: Number(p.avgRating),
      variants: p.variants.map((v) => ({
        ...v, price: v.price?.toFixed(2) ?? null, compareAtPrice: v.compareAtPrice?.toFixed(2) ?? null, costPrice: v.costPrice?.toFixed(2) ?? null,
        inventory: v.inventory.map((i) => ({ id: i.id, warehouse: i.warehouse, onHand: i.quantityOnHand, reserved: i.quantityReserved, available: i.quantityOnHand - i.quantityReserved, reorderLevel: i.reorderLevel, averageCost: i.averageCost.toFixed(2) })),
      })),
    };
  }

  private async validateRefs(dto: ProductInput) {
    const [cat, brand, vendor] = await Promise.all([
      this.prisma.category.findFirst({ where: { id: dto.categoryId, deletedAt: null } }),
      dto.brandId ? this.prisma.brand.findFirst({ where: { id: dto.brandId, deletedAt: null } }) : null,
      dto.vendorId ? this.prisma.vendor.findFirst({ where: { id: dto.vendorId, deletedAt: null } }) : null,
    ]);
    if (!cat) throw new BadRequestException({ message: 'Choose a valid category', code: 'VALIDATION_FAILED', details: [{ field: 'categoryId', messages: ['Choose a valid category'] }] });
    if (dto.brandId && !brand) throw new BadRequestException('Brand not found');
    if (dto.vendorId && !vendor) throw new BadRequestException('Vendor not found');
    if (dto.compareAtPrice && !D(dto.compareAtPrice).gt(D(dto.basePrice))) {
      throw new BadRequestException({ message: 'Compare-at price must be higher than the price', code: 'VALIDATION_FAILED', details: [{ field: 'compareAtPrice', messages: ['Must be higher than the price'] }] });
    }
    const combos = new Set<string>();
    for (const v of dto.variants ?? []) {
      const key = `${v.color ?? ''}|${v.size ?? ''}`;
      if (combos.has(key)) throw new BadRequestException(`Two variants share colour "${v.color ?? '—'}" and size "${v.size ?? '—'}"`);
      combos.add(key);
      if (v.compareAtPrice && !D(v.compareAtPrice).gt(D(v.price ?? dto.basePrice))) throw new BadRequestException(`Variant ${v.sku ?? key}: compare-at price must be higher than its price`);
    }
  }

  private async uniqueSlug(tx: Prisma.TransactionClient, base: string, excludeId?: number) {
    let slug = base || 'product';
    for (let n = 2; await tx.product.findFirst({ where: { slug, ...(excludeId && { id: { not: excludeId } }) }, select: { id: true } }); n++) slug = `${base}-${n}`;
    return slug;
  }

  private async nextStyleCode(tx: Prisma.TransactionClient) {
    const last = await tx.product.findFirst({ where: { styleCode: { startsWith: 'VL-' } }, orderBy: { id: 'desc' }, select: { styleCode: true } });
    let n = Number(last?.styleCode.match(/VL-(\d+)/)?.[1] ?? 1000) + 1;
    while (await tx.product.findUnique({ where: { styleCode: `VL-${n}` }, select: { id: true } })) n++;
    return `VL-${n}`;
  }

  /** Creates/updates/deactivates variants to match the submitted list. New variants get inventory rows in every warehouse. */
  private async syncVariants(tx: Prisma.TransactionClient, productId: number, styleCode: string, variants: VariantInput[], userId: number) {
    const existing = await tx.productVariant.findMany({ where: { productId, deletedAt: null } });
    const warehouses = await tx.warehouse.findMany({ where: { deletedAt: null } });
    const keep = new Set<number>();
    for (const [i, v] of variants.entries()) {
      const data = {
        color: v.color ?? null, colorHex: v.colorHex ?? null, size: v.size ?? null,
        price: v.price ? D(v.price) : null, compareAtPrice: v.compareAtPrice ? D(v.compareAtPrice) : null,
        costPrice: v.costPrice ? D(v.costPrice) : null, barcode: v.barcode ?? null, isActive: v.isActive ?? true, sortOrder: i,
      };
      const match = v.id ? existing.find((e) => e.id === v.id) : existing.find((e) => (e.color ?? null) === data.color && (e.size ?? null) === data.size);
      if (v.id && !match) throw new BadRequestException(`Variant ${v.id} does not belong to this product`);
      if (match) {
        keep.add(match.id);
        await tx.productVariant.update({ where: { id: match.id }, data: { ...data, ...(v.sku && { sku: v.sku }) } });
        continue;
      }
      const sku = v.sku ?? [styleCode, skuPart(v.color), skuPart(v.size)].filter(Boolean).join('-');
      const created = await tx.productVariant.create({ data: { ...data, productId, sku } });
      keep.add(created.id);
      for (const w of warehouses) {
        const qty = v.stock?.find((s) => s.warehouseId === w.id)?.quantity ?? 0;
        const inv = await tx.inventory.create({ data: { variantId: created.id, warehouseId: w.id, quantityOnHand: qty, averageCost: data.costPrice ?? 0 } });
        if (qty > 0) {
          await tx.stockMovement.create({ data: { inventoryId: inv.id, type: StockMovementType.OPENING_BALANCE, quantity: qty, balanceAfter: qty, unitCost: data.costPrice, userId, note: 'Opening stock' } });
        }
      }
    }
    // Variants removed from the form are deactivated, never hard-deleted: past orders reference them.
    const drop = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (drop.length) await tx.productVariant.updateMany({ where: { id: { in: drop } }, data: { isActive: false } });
  }

  private async writeChildren(tx: Prisma.TransactionClient, productId: number, dto: ProductInput) {
    if (dto.images) {
      await tx.productImage.deleteMany({ where: { productId } });
      if (dto.images.length) await tx.productImage.createMany({ data: dto.images.map((im, i) => ({ productId, url: im.url, color: im.color ?? null, altText: im.alt ?? null, sortOrder: i })) });
    }
    if (dto.attributes) {
      await tx.productAttribute.deleteMany({ where: { productId } });
      if (dto.attributes.length) await tx.productAttribute.createMany({ data: dto.attributes.map((a, i) => ({ productId, name: a.name, value: a.value, sortOrder: i })) });
    }
  }

  async create(user: AuthUser, dto: ProductInput, ctx: RequestContext) {
    await this.validateRefs(dto);
    if (!dto.variants?.length) throw new BadRequestException('Add at least one variant (use "One Size" for single-size items)');
    const id = await this.prisma.$transaction(async (tx) => {
      const styleCode = dto.styleCode ?? (await this.nextStyleCode(tx));
      if (await tx.product.findUnique({ where: { styleCode }, select: { id: true } })) throw new ConflictException(`Style code ${styleCode} is already used`);
      const status = dto.status ?? ProductStatus.DRAFT;
      const p = await tx.product.create({
        data: {
          name: dto.name, slug: await this.uniqueSlug(tx, dto.slug ?? slugify(dto.name)), styleCode, categoryId: dto.categoryId,
          brandId: dto.brandId ?? null, vendorId: dto.vendorId ?? null, shortDescription: dto.shortDescription, description: dto.description,
          material: dto.material, careInstructions: dto.careInstructions, videoUrl: dto.videoUrl,
          basePrice: D(dto.basePrice), compareAtPrice: dto.compareAtPrice ? D(dto.compareAtPrice) : null,
          status, isFeatured: dto.isFeatured ?? false, tags: dto.tags ?? [], publishedAt: status === 'ACTIVE' ? new Date() : null,
        },
      });
      await this.syncVariants(tx, p.id, styleCode, dto.variants!, user.id);
      await this.writeChildren(tx, p.id, dto);
      await this.audit.log({ userId: user.id, action: 'products.created', entityType: 'product', entityId: p.id, newValues: { name: p.name, styleCode, status }, ctx }, tx);
      return p.id;
    }, { timeout: 30_000 });
    return this.get(id);
  }

  async update(user: AuthUser, id: number, dto: ProductInput, ctx: RequestContext) {
    const before = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Product not found');
    await this.validateRefs(dto);
    await this.prisma.$transaction(async (tx) => {
      const status = dto.status ?? before.status;
      await tx.product.update({
        where: { id },
        data: {
          name: dto.name, slug: dto.slug ? await this.uniqueSlug(tx, dto.slug, id) : undefined,
          styleCode: dto.styleCode && dto.styleCode !== before.styleCode ? dto.styleCode : undefined,
          categoryId: dto.categoryId, brandId: dto.brandId === undefined ? undefined : dto.brandId, vendorId: dto.vendorId === undefined ? undefined : dto.vendorId,
          shortDescription: dto.shortDescription ?? null, description: dto.description ?? null, material: dto.material ?? null,
          careInstructions: dto.careInstructions ?? null, videoUrl: dto.videoUrl ?? null,
          basePrice: D(dto.basePrice), compareAtPrice: dto.compareAtPrice ? D(dto.compareAtPrice) : null,
          status, isFeatured: dto.isFeatured ?? before.isFeatured, tags: dto.tags ?? (before.tags as Prisma.InputJsonValue) ?? [],
          publishedAt: status === 'ACTIVE' && !before.publishedAt ? new Date() : undefined,
          rejectionReason: status === 'ACTIVE' ? null : undefined,
        },
      });
      if (dto.variants) await this.syncVariants(tx, id, dto.styleCode ?? before.styleCode, dto.variants, user.id);
      await this.writeChildren(tx, id, dto);
      if (status === 'ACTIVE') await this.assertSellable(tx, id);
      await this.audit.log({
        userId: user.id, action: 'products.updated', entityType: 'product', entityId: id, ctx,
        oldValues: { name: before.name, basePrice: before.basePrice.toFixed(2), status: before.status },
        newValues: { name: dto.name, basePrice: dto.basePrice, status },
      }, tx);
    }, { timeout: 30_000 });
    return this.get(id);
  }

  async setStatus(user: AuthUser, id: number, status: ProductStatus, ctx: RequestContext, reason?: string) {
    const p = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundException('Product not found');
    if (status === 'ACTIVE') await this.assertSellable(this.prisma, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id },
        data: { status, rejectionReason: status === 'REJECTED' ? reason : null, ...(status === 'ACTIVE' && !p.publishedAt && { publishedAt: new Date() }) },
      });
      await this.audit.log({ userId: user.id, action: `products.status_${status.toLowerCase()}`, entityType: 'product', entityId: id, oldValues: { status: p.status }, newValues: { status, reason }, ctx }, tx);
    });
    return this.get(id);
  }

  /** Live products must be buyable: at least one active variant and one image. */
  private async assertSellable(db: Prisma.TransactionClient, id: number) {
    const [variants, images] = await Promise.all([
      db.productVariant.count({ where: { productId: id, isActive: true, deletedAt: null } }),
      db.productImage.count({ where: { productId: id } }),
    ]);
    if (!variants || !images) throw new BadRequestException('A product needs at least one active variant and one image before it can go live');
  }

  async remove(user: AuthUser, id: number, ctx: RequestContext) {
    const p = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundException('Product not found');
    const reserved = await this.prisma.inventory.aggregate({ where: { variant: { productId: id } }, _sum: { quantityReserved: true } });
    if ((reserved._sum.quantityReserved ?? 0) > 0) throw new ConflictException('This product has stock reserved for open orders. Archive it instead, then delete once those orders are fulfilled.');
    await this.prisma.$transaction(async (tx) => {
      // Soft delete keeps order history intact; the slug is freed for reuse.
      await tx.product.update({ where: { id }, data: { deletedAt: new Date(), status: 'ARCHIVED', slug: `${p.slug}-deleted-${id}`.slice(0, 220) } });
      await tx.wishlistItem.deleteMany({ where: { productId: id } });
      await tx.cartItem.deleteMany({ where: { variant: { productId: id }, cart: { status: 'ACTIVE' } } });
      await this.audit.log({ userId: user.id, action: 'products.deleted', entityType: 'product', entityId: id, oldValues: { name: p.name, styleCode: p.styleCode }, ctx }, tx);
    });
    return { deleted: true };
  }

  // ─── CSV ───

  static CSV_HEADER = ['style_code', 'name', 'slug', 'category_slug', 'brand', 'status', 'base_price', 'compare_at_price', 'material', 'short_description',
    'sku', 'color', 'color_hex', 'size', 'variant_price', 'cost_price', 'variant_active', 'stock_on_hand'];

  async exportRows() {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      orderBy: { id: 'asc' },
      include: { category: { select: { slug: true } }, brand: { select: { name: true } },
        variants: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' }, include: { inventory: { select: { quantityOnHand: true } } } } },
    });
    return products.flatMap((p) => p.variants.map((v) => [
      p.styleCode, p.name, p.slug, p.category.slug, p.brand?.name ?? '', p.status, p.basePrice.toFixed(2), p.compareAtPrice?.toFixed(2) ?? '',
      p.material ?? '', p.shortDescription ?? '', v.sku, v.color ?? '', v.colorHex ?? '', v.size ?? '', v.price?.toFixed(2) ?? '', v.costPrice?.toFixed(2) ?? '',
      v.isActive ? 'yes' : 'no', v.inventory.reduce((s, i) => s + i.quantityOnHand, 0),
    ]));
  }

  /**
   * Upserts products (by style_code) and variants (by sku) from CSV. Stock is NOT imported:
   * quantities change only through receipts, transfers and adjustments so the ledger stays true.
   */
  async importCsv(user: AuthUser, text: string, dryRun: boolean, ctx: RequestContext) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new BadRequestException('The file has no data rows');
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const required = ['style_code', 'name', 'category_slug', 'base_price', 'sku'];
    const missing = required.filter((r) => !header.includes(r));
    if (missing.length) throw new BadRequestException(`Missing column(s): ${missing.join(', ')}`);
    if (rows.length > 5001) throw new BadRequestException('Import up to 5,000 rows at a time');
    const col = (r: string[], k: string) => (header.indexOf(k) >= 0 ? (r[header.indexOf(k)] ?? '').trim() : '');

    const categories = new Map((await this.prisma.category.findMany({ where: { deletedAt: null } })).map((c) => [c.slug, c.id]));
    const brands = new Map((await this.prisma.brand.findMany({ where: { deletedAt: null } })).map((b) => [b.name.toLowerCase(), b.id]));
    const errors: Array<{ row: number; message: string }> = [];
    const groups = new Map<string, { rowNo: number; dto: ProductInput }>();

    rows.slice(1).forEach((r, i) => {
      const rowNo = i + 2;
      const style = col(r, 'style_code').toUpperCase();
      const price = col(r, 'base_price');
      const categoryId = categories.get(col(r, 'category_slug'));
      const status = (col(r, 'status') || 'DRAFT').toUpperCase();
      const brandName = col(r, 'brand');
      if (!/^[A-Z0-9][A-Z0-9-]{2,63}$/.test(style)) return errors.push({ row: rowNo, message: 'Invalid style_code' });
      if (!/^\d+(\.\d{1,2})?$/.test(price)) return errors.push({ row: rowNo, message: 'Invalid base_price' });
      if (!categoryId) return errors.push({ row: rowNo, message: `Unknown category_slug "${col(r, 'category_slug')}"` });
      if (!Object.values(ProductStatus).includes(status as ProductStatus)) return errors.push({ row: rowNo, message: `Invalid status "${status}"` });
      if (brandName && !brands.has(brandName.toLowerCase())) return errors.push({ row: rowNo, message: `Unknown brand "${brandName}"` });
      const sku = col(r, 'sku').toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9-]{2,79}$/.test(sku)) return errors.push({ row: rowNo, message: 'Invalid sku' });
      const g = groups.get(style) ?? {
        rowNo,
        dto: {
          name: col(r, 'name'), slug: col(r, 'slug') || undefined, styleCode: style, categoryId,
          brandId: brandName ? brands.get(brandName.toLowerCase())! : null, status: status as ProductStatus, basePrice: price,
          compareAtPrice: col(r, 'compare_at_price') || undefined, material: col(r, 'material') || undefined,
          shortDescription: col(r, 'short_description') || undefined, variants: [],
        } as ProductInput,
      };
      g.dto.variants!.push({
        sku, color: col(r, 'color') || undefined, colorHex: col(r, 'color_hex') || undefined, size: col(r, 'size') || undefined,
        price: col(r, 'variant_price') || undefined, costPrice: col(r, 'cost_price') || undefined,
        isActive: col(r, 'variant_active') ? col(r, 'variant_active').toLowerCase() !== 'no' : true,
      });
      groups.set(style, g);
    });

    let created = 0;
    let updated = 0;
    for (const [style, { rowNo, dto }] of groups) {
      try {
        const existing = await this.prisma.product.findUnique({ where: { styleCode: style }, include: { variants: { where: { deletedAt: null } }, images: true } });
        if (existing?.deletedAt) throw new Error('Style code belongs to a deleted product');
        if (!dryRun) {
          if (existing) {
            // Keep variants not mentioned in the file; update the ones that are.
            const bySku = new Map(existing.variants.map((v) => [v.sku, v.id]));
            const merged = [
              ...dto.variants!.map((v) => ({ ...v, id: bySku.get(v.sku!) })),
              ...existing.variants.filter((v) => !dto.variants!.some((x) => x.sku === v.sku)).map((v) => ({
                id: v.id, sku: v.sku, color: v.color ?? undefined, colorHex: v.colorHex ?? undefined, size: v.size ?? undefined,
                price: v.price?.toFixed(2), compareAtPrice: v.compareAtPrice?.toFixed(2), costPrice: v.costPrice?.toFixed(2), isActive: v.isActive,
              })),
            ];
            await this.update(user, existing.id, { ...dto, slug: dto.slug ?? existing.slug, variants: merged }, ctx);
            updated++;
          } else {
            await this.create(user, dto, ctx);
            created++;
          }
        } else if (existing) updated++;
        else created++;
      } catch (e) {
        errors.push({ row: rowNo, message: `${style}: ${(e as { response?: { message?: string } }).response?.message ?? (e as Error).message}` });
      }
    }
    if (!dryRun) await this.audit.log({ userId: user.id, action: 'products.imported', entityType: 'product', newValues: { created, updated, errors: errors.length }, ctx });
    return { dryRun, products: groups.size, created, updated, errors };
  }
}
