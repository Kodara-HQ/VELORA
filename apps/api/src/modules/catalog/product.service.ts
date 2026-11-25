import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Paginated } from '../../common/dto/pagination.dto';
import type { ViewerRef } from '../../common/viewer';
import { CatalogService, ORDER_BY } from './catalog.service';
import { cardSelect, visibleWhere, type CardRow } from './product-card';
import { activePromotionWhere, activePromotions, promoBadge, promoUnitPrice, toCards } from '../promotions/promo-pricing';
import type { ReviewQuery } from './catalog.dto';

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  async detail(slug: string) {
    const p = await this.prisma.product.findFirst({
      where: { AND: [visibleWhere(), { slug }] },
      include: {
        brand: { select: { name: true, slug: true } },
        vendor: { select: { businessName: true, slug: true } },
        category: { select: { name: true, slug: true, sizeGuide: true, parent: { select: { name: true, slug: true, sizeGuide: true } } } },
        images: { orderBy: { sortOrder: 'asc' }, select: { id: true, url: true, altText: true, color: true } },
        attributes: { orderBy: { sortOrder: 'asc' }, select: { name: true, value: true } },
        variants: {
          where: { isActive: true, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true, sku: true, color: true, colorHex: true, size: true, price: true, compareAtPrice: true,
            inventory: { select: { quantityOnHand: true, quantityReserved: true, warehouse: { select: { isActive: true } } } },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('This product is no longer available');

    const [ratingGroups, questions, zones] = await Promise.all([
      this.prisma.productReview.groupBy({ by: ['rating'], where: { productId: p.id, status: 'APPROVED' }, _count: { _all: true } }),
      this.prisma.productQuestion.findMany({
        where: { productId: p.id, status: 'APPROVED', answer: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, question: true, answer: true, answeredAt: true },
      }),
      this.prisma.shippingZone.findMany({
        where: { isActive: true },
        orderBy: { id: 'asc' },
        select: {
          name: true,
          methods: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: { name: true, code: true, fee: true, freeOverAmount: true, minDays: true, maxDays: true },
          },
        },
      }),
    ]);

    const promo = (await activePromotions(this.prisma, [p.id])).get(p.id);
    const listPrice = (v: { price: Prisma.Decimal | null }) => v.price ?? p.basePrice;
    // A live promotion sets the selling price; the list price (or a higher compare-at) becomes the strike-through.
    const priceOf = (v: { price: Prisma.Decimal | null }) => promoUnitPrice(listPrice(v), promo) ?? listPrice(v);
    const compareOf = (v: { price: Prisma.Decimal | null; compareAtPrice: Prisma.Decimal | null }) => {
      const c = promo && promoUnitPrice(listPrice(v), promo) ? listPrice(v) : v.compareAtPrice ?? p.compareAtPrice;
      return c && c.gt(priceOf(v)) ? c.toFixed(2) : null;
    };
    const basePromo = promoUnitPrice(p.basePrice, promo);

    return {
      id: p.id, slug: p.slug, name: p.name, styleCode: p.styleCode,
      brand: p.brand,
      vendor: p.vendor ? { name: p.vendor.businessName, slug: p.vendor.slug } : null,
      shortDescription: p.shortDescription, description: p.description, material: p.material,
      careInstructions: p.careInstructions, videoUrl: p.videoUrl,
      price: priceOf({ price: null }).toFixed(2),
      compareAtPrice: compareOf({ price: null, compareAtPrice: null }),
      promotion: promo && basePromo ? promoBadge(promo, p.basePrice, basePromo) : null,
      currency: p.currency,
      rating: Number(p.avgRating), reviewCount: p.reviewCount,
      breadcrumbs: [
        ...(p.category.parent ? [{ name: p.category.parent.name, slug: p.category.parent.slug }] : []),
        { name: p.category.name, slug: p.category.slug },
      ],
      images: p.images.map((i) => ({ id: i.id, url: i.url, alt: i.altText ?? p.name, color: i.color })),
      attributes: p.attributes,
      variants: p.variants.map((v) => {
        const available = v.inventory
          .filter((i) => i.warehouse.isActive)
          .reduce((s, i) => s + Math.max(0, i.quantityOnHand - i.quantityReserved), 0);
        return {
          id: v.id, sku: v.sku, color: v.color, colorHex: v.colorHex, size: v.size,
          price: priceOf(v).toFixed(2), compareAtPrice: compareOf(v),
          available: Math.min(available, 99),
          lowStock: available > 0 && available <= 3,
        };
      }),
      sizeGuide: p.category.sizeGuide ?? p.category.parent?.sizeGuide ?? null,
      reviewSummary: {
        average: Number(p.avgRating),
        total: p.reviewCount,
        distribution: [5, 4, 3, 2, 1].map((r) => ({ rating: r, count: ratingGroups.find((g) => g.rating === r)?._count._all ?? 0 })),
      },
      questions,
      // One line per delivery zone: the standard (paid, door-to-door) option.
      delivery: zones
        .map((z) => {
          const m = z.methods.find((x) => x.code === 'standard') ?? z.methods[0];
          return m ? {
            zone: z.name, method: m.name, fee: m.fee.toFixed(2),
            freeOver: m.freeOverAmount?.toFixed(2) ?? null, minDays: m.minDays, maxDays: m.maxDays,
          } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    };
  }

  async reviews(slug: string, q: ReviewQuery) {
    const product = await this.prisma.product.findFirst({ where: { slug, deletedAt: null }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');
    const where: Prisma.ProductReviewWhereInput = { productId: product.id, status: 'APPROVED', ...(q.rating && { rating: q.rating }) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productReview.findMany({
        where, skip: q.skip, take: q.pageSize, orderBy: { createdAt: 'desc' },
        select: {
          id: true, rating: true, title: true, body: true, fit: true, images: true, isVerifiedBuyer: true,
          helpfulCount: true, createdAt: true, user: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.productReview.count({ where }),
    ]);
    return new Paginated(rows.map(({ user, ...r }) => ({ ...r, author: `${user.firstName} ${user.lastName.charAt(0)}.` })), total, q);
  }

  /** "Similar" = same department, nearest in price. "Complete the look" = bought together, else best sellers from other departments. */
  async related(slug: string) {
    const p = await this.prisma.product.findFirst({ where: { slug, deletedAt: null }, select: { id: true, categoryId: true, basePrice: true } });
    if (!p) throw new NotFoundException('Product not found');
    const department = await this.catalog.departmentIds(p.categoryId);

    const candidates = await this.prisma.product.findMany({
      where: { AND: [visibleWhere(), { id: { not: p.id } }, { categoryId: { in: department } }] },
      select: cardSelect,
      take: 30,
    });
    const price = Number(p.basePrice);
    const similar = await toCards(this.prisma, candidates
      .sort((a, b) => Math.abs(Number(a.basePrice) - price) - Math.abs(Number(b.basePrice) - price))
      .slice(0, 8));

    const together = await this.prisma.$queryRaw<Array<{ product_id: number }>>`
      SELECT oi2.product_id FROM order_items oi1
      JOIN order_items oi2 ON oi2.order_id = oi1.order_id AND oi2.product_id <> oi1.product_id
      WHERE oi1.product_id = ${p.id} AND oi2.product_id IS NOT NULL
      GROUP BY oi2.product_id ORDER BY COUNT(*) DESC LIMIT 4`;
    let look: CardRow[] = together.length
      ? await this.prisma.product.findMany({
          where: { AND: [visibleWhere(), { id: { in: together.map((t) => Number(t.product_id)) } }] },
          select: cardSelect,
        })
      : [];
    if (look.length < 4) {
      const extra = await this.prisma.product.findMany({
        where: { AND: [visibleWhere(), { id: { notIn: [p.id, ...look.map((r) => r.id)] } }, { categoryId: { notIn: department } }] },
        select: cardSelect,
        orderBy: { soldCount: 'desc' },
        take: 4 - look.length,
      });
      look = [...look, ...extra];
    }
    return { similar, completeTheLook: await toCards(this.prisma, look) };
  }

  async home() {
    const v = visibleWhere();
    const take = 8;
    const [newArrivals, bestSellers, onSale, featured, brands, reviews, tree] = await Promise.all([
      this.prisma.product.findMany({ where: v, select: cardSelect, orderBy: ORDER_BY.newest, take }),
      this.prisma.product.findMany({ where: v, select: cardSelect, orderBy: ORDER_BY.popular, take }),
      this.prisma.product.findMany({ where: { AND: [v, { OR: [{ compareAtPrice: { not: null } }, { promotionProducts: { some: { promotion: activePromotionWhere() } } }] }] }, select: cardSelect, orderBy: ORDER_BY.popular, take }),
      this.prisma.product.findMany({ where: { AND: [v, { isFeatured: true }] }, select: cardSelect, orderBy: { soldCount: 'desc' }, take }),
      this.catalog.brands(true),
      this.prisma.productReview.findMany({
        where: { status: 'APPROVED', rating: { gte: 4 }, body: { not: null }, product: v },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true, rating: true, title: true, body: true, createdAt: true,
          user: { select: { firstName: true, lastName: true } },
          product: { select: { name: true, slug: true, images: { take: 1, orderBy: { sortOrder: 'asc' }, select: { url: true } } } },
        },
      }),
      this.catalog.categoryTree(),
    ]);
    return {
      categories: tree.tree.map((c) => ({ name: c.name, slug: c.slug, imageUrl: c.imageUrl })),
      newArrivals: await toCards(this.prisma, newArrivals),
      bestSellers: await toCards(this.prisma, bestSellers),
      onSale: await toCards(this.prisma, onSale),
      featured: await toCards(this.prisma, featured),
      brands,
      reviews: reviews.map(({ user, product, ...r }) => ({
        ...r,
        author: `${user.firstName} ${user.lastName.charAt(0)}.`,
        product: { name: product.name, slug: product.slug, image: product.images[0]?.url ?? null },
      })),
    };
  }

  // ─── Views, recently viewed, recommendations ───

  async recordView(productId: number, viewer: ViewerRef) {
    if (!viewer.userId && !viewer.guestId) return { recorded: false };
    const exists = await this.prisma.product.count({ where: { id: productId, deletedAt: null } });
    if (!exists) throw new NotFoundException('Product not found');
    const who: Prisma.ProductViewWhereInput = viewer.userId ? { userId: viewer.userId } : { sessionId: viewer.guestId };
    // One counted view per viewer per product per 30 minutes; repeat visits just bump the timestamp.
    const recent = await this.prisma.productView.findFirst({
      where: { ...who, productId, viewedAt: { gte: new Date(Date.now() - 30 * 60_000) } },
      select: { id: true },
    });
    if (recent) {
      await this.prisma.productView.update({ where: { id: recent.id }, data: { viewedAt: new Date() } });
      return { recorded: false };
    }
    await this.prisma.$transaction([
      this.prisma.productView.create({ data: { productId, userId: viewer.userId, sessionId: viewer.userId ? null : viewer.guestId } }),
      this.prisma.product.update({ where: { id: productId }, data: { viewCount: { increment: 1 } } }),
    ]);
    return { recorded: true };
  }

  private async recentIds(viewer: ViewerRef, limit = 12) {
    if (!viewer.userId && !viewer.guestId) return [];
    const views = await this.prisma.productView.findMany({
      where: viewer.userId ? { userId: viewer.userId } : { sessionId: viewer.guestId },
      orderBy: { viewedAt: 'desc' },
      take: 60,
      select: { productId: true },
    });
    return [...new Set(views.map((v) => v.productId))].slice(0, limit);
  }

  async recentlyViewed(viewer: ViewerRef) {
    const ids = await this.recentIds(viewer);
    if (!ids.length) return [];
    const rows = await this.prisma.product.findMany({ where: { AND: [visibleWhere(), { id: { in: ids } }] }, select: cardSelect });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return toCards(this.prisma, ids.map((id) => byId.get(id)).filter((r): r is CardRow => !!r));
  }

  /**
   * "Picked for you": departments the shopper browses, buys from and wishlists, weighted by how strong
   * the signal is (purchase > wishlist > view), excluding what they already bought or just looked at.
   */
  async recommendations(viewer: ViewerRef) {
    const seen = await this.recentIds(viewer, 30);
    const [bought, wished] = viewer.userId ? await Promise.all([
      this.prisma.orderItem.findMany({ where: { order: { userId: viewer.userId, status: { notIn: ['CANCELLED', 'PENDING_PAYMENT'] } }, productId: { not: null } }, orderBy: { id: 'desc' }, take: 30, select: { productId: true } }),
      this.prisma.wishlistItem.findMany({ where: { wishlist: { userId: viewer.userId } }, take: 30, select: { productId: true } }),
    ]) : [[], []];
    const boughtIds = bought.map((b) => b.productId!);
    const weights = new Map<number, number>();
    const add = (ids: number[], w: number) => ids.forEach((id) => weights.set(id, (weights.get(id) ?? 0) + w));
    add(seen, 1); add(wished.map((x) => x.productId), 2); add(boughtIds, 3);

    let rows: CardRow[] = [];
    if (weights.size) {
      const signals = await this.prisma.product.findMany({ where: { id: { in: [...weights.keys()] } }, select: { id: true, categoryId: true, basePrice: true } });
      const deptScore = new Map<number, number>();
      for (const p of signals) for (const c of await this.catalog.departmentIds(p.categoryId)) deptScore.set(c, (deptScore.get(c) ?? 0) + (weights.get(p.id) ?? 0));
      const avgPrice = signals.reduce((t, p) => t + Number(p.basePrice), 0) / Math.max(1, signals.length);
      const candidates = await this.prisma.product.findMany({
        where: { AND: [visibleWhere(), { categoryId: { in: [...deptScore.keys()] } }, { id: { notIn: [...seen, ...boughtIds] } }] },
        select: cardSelect, orderBy: [{ avgRating: 'desc' }, { soldCount: 'desc' }], take: 60,
      });
      // Department affinity first, then products near the shopper's usual price point.
      rows = candidates
        .map((c) => ({ c, score: (deptScore.get(c.categoryId) ?? 0) * 10 - Math.abs(Number(c.basePrice) - avgPrice) / Math.max(avgPrice, 1) + Number(c.avgRating) }))
        .sort((x, y) => y.score - x.score)
        .slice(0, 8)
        .map((x) => x.c);
    }
    if (rows.length < 8) {
      const fill = await this.prisma.product.findMany({
        where: { AND: [visibleWhere(), { id: { notIn: [...seen, ...boughtIds, ...rows.map((r) => r.id)] } }] },
        select: cardSelect,
        orderBy: ORDER_BY.popular,
        take: 8 - rows.length,
      });
      rows = [...rows, ...fill];
    }
    return toCards(this.prisma, rows);
  }
}
