import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException,
  Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUrl, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import type { Request, Response } from 'express';
import { PERMISSIONS, type AuthUser } from '@velora/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { requestContext } from '../../common/utils/request';
import type { RequestContext } from '../../common/types';
import { AuditService } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CatalogService } from '../catalog/catalog.service';
import { sendCsv } from './admin-common';
import { AdminProductQuery, ProductInput, RejectDto } from './admin-products.dto';
import { AdminProductsService, slugify } from './admin-products.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndef = ({ value }: { value: unknown }) => (typeof value === 'string' && !value.trim() ? undefined : value);

class CategoryInput {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(140) slug?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() parentId?: number | null;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsUrl({ require_tld: false }) @MaxLength(512) imageUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

class ReorderItem {
  @ApiProperty() @IsInt() id: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() parentId: number | null;
  @ApiProperty() @IsInt() @Min(0) sortOrder: number;
}
class ReorderDto {
  @ApiProperty({ type: [ReorderItem] }) @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReorderItem) items: ReorderItem[];
}

class BrandInput {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsUrl({ require_tld: false }) @MaxLength(512) logoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(emptyToUndef) @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isFeatured?: boolean;
}

@Injectable()
export class AdminTaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
  ) {}

  async categories() {
    const rows = await this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: { where: { deletedAt: null } } } } },
    });
    type Node = (typeof rows)[number] & { productCount: number; children: Node[] };
    const nodes = new Map<number, Node>(rows.map((r) => [r.id, { ...r, productCount: r._count.products, children: [] }]));
    const tree: Node[] = [];
    for (const n of nodes.values()) (n.parentId && nodes.get(n.parentId) ? nodes.get(n.parentId)!.children : tree).push(n);
    const strip = ({ _count, ...n }: Node): unknown => ({ ...n, children: n.children.map(strip) });
    return tree.map(strip);
  }

  private async assertNoCycle(id: number, parentId: number | null | undefined) {
    for (let cur = parentId ?? null, hops = 0; cur; hops++) {
      if (cur === id) throw new BadRequestException('A category cannot be placed inside itself or one of its sub-categories');
      if (hops > 20) break;
      cur = (await this.prisma.category.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null;
    }
  }

  private async uniqueSlug(base: string, excludeId?: number) {
    let slug = base;
    for (let n = 2; await this.prisma.category.findFirst({ where: { slug, ...(excludeId && { id: { not: excludeId } }) } }); n++) slug = `${base}-${n}`;
    return slug;
  }

  async createCategory(user: AuthUser, dto: CategoryInput, ctx: RequestContext) {
    if (dto.parentId && !(await this.prisma.category.findFirst({ where: { id: dto.parentId, deletedAt: null } }))) throw new BadRequestException('Parent category not found');
    const parent = dto.parentId ? await this.prisma.category.findUnique({ where: { id: dto.parentId } }) : null;
    const slug = await this.uniqueSlug(dto.slug ?? slugify(parent ? `${parent.slug} ${dto.name}` : dto.name));
    const max = await this.prisma.category.aggregate({ where: { parentId: dto.parentId ?? null }, _max: { sortOrder: true } });
    const c = await this.prisma.category.create({
      data: { name: dto.name, slug, parentId: dto.parentId ?? null, description: dto.description, imageUrl: dto.imageUrl, isActive: dto.isActive ?? true, sortOrder: (max._max.sortOrder ?? -1) + 1 },
    });
    this.catalog.invalidateCategories();
    await this.audit.log({ userId: user.id, action: 'categories.created', entityType: 'category', entityId: c.id, newValues: { name: c.name, slug }, ctx });
    return c;
  }

  async updateCategory(user: AuthUser, id: number, dto: CategoryInput, ctx: RequestContext) {
    const before = await this.prisma.category.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Category not found');
    await this.assertNoCycle(id, dto.parentId);
    const c = await this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name, slug: dto.slug ? await this.uniqueSlug(dto.slug, id) : undefined,
        parentId: dto.parentId === undefined ? undefined : dto.parentId, description: dto.description ?? null, imageUrl: dto.imageUrl ?? null,
        isActive: dto.isActive ?? before.isActive,
      },
    });
    this.catalog.invalidateCategories();
    await this.audit.log({ userId: user.id, action: 'categories.updated', entityType: 'category', entityId: id, oldValues: { name: before.name, parentId: before.parentId, isActive: before.isActive }, newValues: { name: c.name, parentId: c.parentId, isActive: c.isActive }, ctx });
    return c;
  }

  async deleteCategory(user: AuthUser, id: number, ctx: RequestContext) {
    const c = await this.prisma.category.findFirst({ where: { id, deletedAt: null }, include: { _count: { select: { children: { where: { deletedAt: null } }, products: { where: { deletedAt: null } } } } } });
    if (!c) throw new NotFoundException('Category not found');
    if (c._count.children) throw new ConflictException('Move or delete its sub-categories first');
    if (c._count.products) throw new ConflictException(`${c._count.products} product(s) are in this category. Move them first, or hide the category instead.`);
    await this.prisma.category.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, slug: `${c.slug}-deleted-${id}` } });
    this.catalog.invalidateCategories();
    await this.audit.log({ userId: user.id, action: 'categories.deleted', entityType: 'category', entityId: id, oldValues: { name: c.name }, ctx });
    return { deleted: true };
  }

  async reorder(user: AuthUser, dto: ReorderDto, ctx: RequestContext) {
    for (const item of dto.items) await this.assertNoCycle(item.id, item.parentId);
    await this.prisma.$transaction(dto.items.map((i) => this.prisma.category.update({ where: { id: i.id }, data: { parentId: i.parentId ?? null, sortOrder: i.sortOrder } })));
    this.catalog.invalidateCategories();
    await this.audit.log({ userId: user.id, action: 'categories.reordered', entityType: 'category', newValues: { count: dto.items.length }, ctx });
    return this.categories();
  }

  brands() {
    return this.prisma.brand.findMany({
      where: { deletedAt: null }, orderBy: { name: 'asc' },
      include: { _count: { select: { products: { where: { deletedAt: null } } } } },
    }).then((rows) => rows.map(({ _count, ...b }) => ({ ...b, productCount: _count.products })));
  }

  async saveBrand(user: AuthUser, id: number | null, dto: BrandInput, ctx: RequestContext) {
    const slug = slugify(dto.name);
    const clash = await this.prisma.brand.findFirst({ where: { OR: [{ name: dto.name }, { slug }], deletedAt: null, ...(id && { id: { not: id } }) } });
    if (clash) throw new ConflictException('A brand with this name already exists');
    const data = { name: dto.name, slug, logoUrl: dto.logoUrl ?? null, description: dto.description ?? null, isFeatured: dto.isFeatured ?? false };
    const b = id ? await this.prisma.brand.update({ where: { id }, data }) : await this.prisma.brand.create({ data });
    await this.audit.log({ userId: user.id, action: id ? 'brands.updated' : 'brands.created', entityType: 'brand', entityId: b.id, newValues: data, ctx });
    return b;
  }

  async deleteBrand(user: AuthUser, id: number, ctx: RequestContext) {
    const used = await this.prisma.product.count({ where: { brandId: id, deletedAt: null } });
    if (used) throw new ConflictException(`${used} product(s) use this brand. Reassign them first.`);
    const b = await this.prisma.brand.update({ where: { id }, data: { deletedAt: new Date(), name: `deleted-${id}-${Date.now()}`, slug: `deleted-${id}-${Date.now()}` } });
    await this.audit.log({ userId: user.id, action: 'brands.deleted', entityType: 'brand', entityId: id, ctx });
    return { deleted: !!b };
  }
}

@ApiTags('Admin · Products')
@ApiBearerAuth()
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly svc: AdminProductsService) {}

  @Get() @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  list(@Query() q: AdminProductQuery) { return this.svc.list(q); }

  @Get('export.csv') @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  async export(@Res({ passthrough: true }) res: Response) {
    return sendCsv(res, `velora-products-${new Date().toISOString().slice(0, 10)}.csv`, AdminProductsService.CSV_HEADER, await this.svc.exportRows());
  }

  @Post('import') @HttpCode(200) @RequirePermissions(PERMISSIONS.PRODUCTS_CREATE, PERMISSIONS.PRODUCTS_UPDATE)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  import(@UploadedFile() file: Express.Multer.File | undefined, @Query('dryRun') dryRun: string | undefined, @CurrentUser() u: AuthUser, @Req() req: Request) {
    if (!file) throw new BadRequestException('Attach a CSV file');
    const text = file.buffer.toString('utf8');
    if (text.includes('\u0000')) throw new BadRequestException('That does not look like a CSV file');
    return this.svc.importCsv(u, text, dryRun === 'true', requestContext(req));
  }

  @Get(':id') @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  get(@Param('id', ParseIntPipe) id: number) { return this.svc.get(id); }

  @Post() @RequirePermissions(PERMISSIONS.PRODUCTS_CREATE)
  create(@Body() dto: ProductInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.svc.create(u, dto, requestContext(req)); }

  @Put(':id') @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: ProductInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.update(u, id, dto, requestContext(req));
  }

  @Post(':id/archive') @HttpCode(200) @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  archive(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.svc.setStatus(u, id, 'ARCHIVED', requestContext(req)); }

  @Post(':id/publish') @HttpCode(200) @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  publish(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.svc.setStatus(u, id, 'ACTIVE', requestContext(req)); }

  @Post(':id/approve') @HttpCode(200) @RequirePermissions(PERMISSIONS.PRODUCTS_APPROVE)
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.svc.setStatus(u, id, 'ACTIVE', requestContext(req)); }

  @Post(':id/reject') @HttpCode(200) @RequirePermissions(PERMISSIONS.PRODUCTS_APPROVE)
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectDto, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.setStatus(u, id, 'REJECTED', requestContext(req), dto.reason);
  }

  @Delete(':id') @RequirePermissions(PERMISSIONS.PRODUCTS_DELETE)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.svc.remove(u, id, requestContext(req)); }
}

@ApiTags('Admin · Categories & brands')
@ApiBearerAuth()
@Controller('admin')
export class AdminTaxonomyController {
  constructor(private readonly svc: AdminTaxonomyService) {}

  @Get('categories') @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  categories() { return this.svc.categories(); }

  @Post('categories') @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  createCategory(@Body() dto: CategoryInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.svc.createCategory(u, dto, requestContext(req)); }

  @Put('categories/reorder') @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  reorder(@Body() dto: ReorderDto, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.svc.reorder(u, dto, requestContext(req)); }

  @Patch('categories/:id') @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: CategoryInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.updateCategory(u, id, dto, requestContext(req));
  }

  @Delete('categories/:id') @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  deleteCategory(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.svc.deleteCategory(u, id, requestContext(req)); }

  @Get('brands') @RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
  brands() { return this.svc.brands(); }

  @Post('brands') @RequirePermissions(PERMISSIONS.BRANDS_MANAGE)
  createBrand(@Body() dto: BrandInput, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.svc.saveBrand(u, null, dto, requestContext(req)); }

  @Patch('brands/:id') @RequirePermissions(PERMISSIONS.BRANDS_MANAGE)
  updateBrand(@Param('id', ParseIntPipe) id: number, @Body() dto: BrandInput, @CurrentUser() u: AuthUser, @Req() req: Request) {
    return this.svc.saveBrand(u, id, dto, requestContext(req));
  }

  @Delete('brands/:id') @RequirePermissions(PERMISSIONS.BRANDS_MANAGE)
  deleteBrand(@Param('id', ParseIntPipe) id: number, @CurrentUser() u: AuthUser, @Req() req: Request) { return this.svc.deleteBrand(u, id, requestContext(req)); }
}

@Module({
  imports: [CatalogModule],
  controllers: [AdminProductsController, AdminTaxonomyController],
  providers: [AdminProductsService, AdminTaxonomyService],
})
export class AdminCatalogModule {}

export type { Prisma };
