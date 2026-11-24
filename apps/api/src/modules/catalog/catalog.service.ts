import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Paginated } from '../../common/dto/pagination.dto';
import { cardSelect, sortSizes, toCard, visibleWhere } from './product-card';
import type { FacetQuery, ProductQuery, Sort } from './catalog.dto';

export const ORDER_BY: Record<Sort, Prisma.ProductOrderByWithRelationInput[]> = {
  recommended: [{ isFeatured: 'desc' }, { soldCount: 'desc' }, { id: 'desc' }],
  newest: [{ publishedAt: 'desc' }, { id: 'desc' }],
  popular: [{ soldCount: 'desc' }, { id: 'desc' }],
  price_asc: [{ basePrice: 'asc' }, { id: 'asc' }],
  price_desc: [{ basePrice: 'desc' }, { id: 'desc' }],
  rating: [{ avgRating: 'desc' }, { reviewCount: 'desc' }, { id: 'desc' }],
};

export interface CategoryNode {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  imageUrl: string | null;
  sortOrder: number;
  children: CategoryNode[];
}

interface CategoryCache {
  at: number;
  tree: CategoryNode[];
  byId: Map<number, CategoryNode>;
  bySlug: Map<string, CategoryNode>;
}

@Injectable()
export class CatalogService {
  private cache: CategoryCache | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ─── Categories & brands ───

  async categoryTree(): Promise<CategoryCache> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache;
    const rows = await this.prisma.category.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, parentId: true, name: true, slug: true, imageUrl: true, sortOrder: true },
    });
    const byId = new Map<number, CategoryNode>(rows.map((r) => [r.id, { ...r, children: [] }]));
    const tree: CategoryNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else if (!node.parentId) tree.push(node);
    }
    this.cache = { at: Date.now(), tree, byId, bySlug: new Map([...byId.values()].map((n) => [n.slug, n])) };
    return this.cache;
  }

  /** Call after any admin change to categories. */
  invalidateCategories() {
    this.cache = null;
  }

  async categories() {
    const strip = (n: CategoryNode): unknown => ({ id: n.id, name: n.name, slug: n.slug, imageUrl: n.imageUrl, children: n.children.map(strip) });
    return (await this.categoryTree()).tree.map(strip);
  }

  async category(slug: string) {
    const { bySlug, byId } = await this.categoryTree();
    const node = bySlug.get(slug);
    if (!node) throw new NotFoundException('Category not found');
    const parent = node.parentId ? byId.get(node.parentId) ?? null : null;
    const pick = (n: CategoryNode) => ({ name: n.name, slug: n.slug });
    return {
      name: node.name, slug: node.slug, imageUrl: node.imageUrl,
      parent: parent && pick(parent),
      children: node.children.map(pick),
      siblings: parent ? parent.children.map(pick) : [],
    };
  }

  async descendantIds(slug: string): Promise<number[] | null> {
    const node = (await this.categoryTree()).bySlug.get(slug);
    if (!node) return null;
    const ids: number[] = [];
    const walk = (n: CategoryNode) => { ids.push(n.id); n.children.forEach(walk); };
    walk(node);
    return ids;
  }

  /** The top-level department a category belongs to, plus all its sub-categories. */
  async departmentIds(categoryId: number): Promise<number[]> {
    const { byId } = await this.categoryTree();
    const top = byId.get(categoryId)?.parentId ?? categoryId;
    return [top, ...(byId.get(top)?.children.map((c) => c.id) ?? [])];
  }

  brands(featuredOnly = false) {
    return this.prisma.brand.findMany({
      where: { deletedAt: null, ...(featuredOnly && { isFeatured: true }) },
      orderBy: { name: 'asc' },
      select: { name: true, slug: true, logoUrl: true, isFeatured: true },
    });
  }

  // ─── Listing & search ───

  private async inStockProductIds(): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<Array<{ product_id: number }>>`
      SELECT DISTINCT v.product_id FROM product_variants v
      JOIN inventory i ON i.variant_id = v.id
      WHERE v.is_active = 1 AND v.deleted_at IS NULL AND i.quantity_on_hand - i.quantity_reserved > 0`;
    return rows.map((r) => Number(r.product_id));
  }

  private searchWhere(q?: string): Prisma.ProductWhereInput | null {
    const term = q?.trim();
    if (!term) return null;
    // Every word must match the name, brand, category or material.
    return {
      AND: term.split(/\s+/).slice(0, 5).map((w) => ({
        OR: [
          { name: { contains: w } },
          { brand: { name: { contains: w } } },
          { category: { name: { contains: w } } },
          { material: { contains: w } },
        ],
      })),
    };
  }

  private async baseWhere(category?: string, q?: string): Promise<Prisma.ProductWhereInput[]> {
    const and: Prisma.ProductWhereInput[] = [visibleWhere()];
    if (category) {
      const ids = await this.descendantIds(category);
      if (!ids) throw new NotFoundException('Category not found');
      and.push({ categoryId: { in: ids } });
    }
    const search = this.searchWhere(q);
    if (search) and.push(search);
    return and;
  }

  async list(q: ProductQuery) {
    const and = await this.baseWhere(q.category, q.q);
    if (q.brand?.length) and.push({ brand: { slug: { in: q.brand } } });
    if (q.color?.length || q.size?.length) {
      and.push({
        variants: {
          some: {
            isActive: true, deletedAt: null,
            ...(q.color?.length && { color: { in: q.color } }),
            ...(q.size?.length && { size: { in: q.size } }),
          },
        },
      });
    }
    if (q.minPrice != null || q.maxPrice != null) {
      and.push({ basePrice: { ...(q.minPrice != null && { gte: q.minPrice }), ...(q.maxPrice != null && { lte: q.maxPrice }) } });
    }
    if (q.onSale) and.push({ compareAtPrice: { not: null } });
    if (q.minRating) and.push({ avgRating: { gte: q.minRating } });
    if (q.inStock) and.push({ id: { in: await this.inStockProductIds() } });

    const where: Prisma.ProductWhereInput = { AND: and };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({ where, select: cardSelect, orderBy: ORDER_BY[q.sort], skip: q.skip, take: q.pageSize }),
      this.prisma.product.count({ where }),
    ]);
    if (q.q && q.page === 1) void this.recordSearch(q.q, total);
    return new Paginated(rows.map(toCard), total, q);
  }

  /** Filter options for a category or search, with counts. */
  async facets(q: FacetQuery) {
    const where: Prisma.ProductWhereInput = { AND: await this.baseWhere(q.category, q.q) };
    const [brandGroups, price, variants] = await Promise.all([
      this.prisma.product.groupBy({ by: ['brandId'], where, _count: { _all: true } }),
      this.prisma.product.aggregate({ where, _min: { basePrice: true }, _max: { basePrice: true } }),
      this.prisma.productVariant.findMany({
        where: { isActive: true, deletedAt: null, product: where },
        select: { color: true, colorHex: true, size: true, productId: true },
      }),
    ]);
    const brandRows = await this.prisma.brand.findMany({
      where: { id: { in: brandGroups.map((b) => b.brandId).filter((x): x is number => x != null) } },
      select: { id: true, name: true, slug: true },
    });
    const count = new Map(brandGroups.map((b) => [b.brandId, b._count._all]));

    const colors = new Map<string, { hex: string | null; products: Set<number> }>();
    const sizes = new Map<string, Set<number>>();
    for (const v of variants) {
      if (v.color) {
        const c = colors.get(v.color) ?? { hex: v.colorHex, products: new Set<number>() };
        c.products.add(v.productId);
        colors.set(v.color, c);
      }
      if (v.size) sizes.set(v.size, (sizes.get(v.size) ?? new Set<number>()).add(v.productId));
    }
    return {
      brands: brandRows.map((b) => ({ name: b.name, slug: b.slug, count: count.get(b.id) ?? 0 })).sort((a, b) => b.count - a.count),
      colors: [...colors].map(([name, c]) => ({ name, hex: c.hex, count: c.products.size })).sort((a, b) => b.count - a.count),
      sizes: sortSizes([...sizes].map(([name, s]) => ({ name, count: s.size }))),
      price: { min: price._min.basePrice?.toFixed(2) ?? '0.00', max: price._max.basePrice?.toFixed(2) ?? '0.00' },
    };
  }

  async suggest(raw: string) {
    const q = raw.trim();
    if (q.length < 2) return { products: [], categories: [], brands: [] };
    const [products, categories, brands] = await Promise.all([
      this.prisma.product.findMany({
        where: { AND: [visibleWhere(), { OR: [{ name: { contains: q } }, { brand: { name: { contains: q } } }] }] },
        select: { slug: true, name: true, basePrice: true, currency: true, images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } } },
        orderBy: { soldCount: 'desc' },
        take: 6,
      }),
      this.prisma.category.findMany({
        where: { isActive: true, deletedAt: null, name: { contains: q } },
        select: { name: true, slug: true, parent: { select: { name: true } } },
        take: 4,
      }),
      this.prisma.brand.findMany({ where: { deletedAt: null, name: { contains: q } }, select: { name: true, slug: true }, take: 3 }),
    ]);
    return {
      products: products.map((p) => ({ slug: p.slug, name: p.name, price: p.basePrice.toFixed(2), currency: p.currency, image: p.images[0]?.url ?? null })),
      categories: categories.map((c) => ({ name: c.name, slug: c.slug, parent: c.parent?.name ?? null })),
      brands,
    };
  }

  async trendingSearches() {
    const rows = await this.prisma.searchTerm.findMany({
      where: { resultCount: { gt: 0 } },
      orderBy: { searchCount: 'desc' },
      take: 8,
      select: { term: true },
    });
    return rows.map((r) => r.term);
  }

  private async recordSearch(raw: string, resultCount: number) {
    const term = raw.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
    if (term.length < 2) return;
    await this.prisma.searchTerm
      .upsert({
        where: { term },
        create: { term, resultCount },
        update: { searchCount: { increment: 1 }, resultCount, lastSearchedAt: new Date() },
      })
      .catch(() => undefined); // analytics must never break search
  }
}
