import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { MessagingService } from '../src/modules/notifications/messaging.service';

/** Phase 6 acceptance: promotions and flash sales, loyalty and referrals, reviews, smart search, messaging, analytics. */
describe('Growth features (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seq = 0;
  const run = randomBytes(3).toString('hex');
  const ip = () => `10.60.${(seq >> 8) & 255}.${seq++ & 255}`;
  const DEMO = 'Test-Demo-Password-123';
  const tokens: Record<string, string> = {};
  const address = { recipientName: 'Kofi Test', phone: '+233241234567', line1: '5 Ring Road', city: 'Accra', region: 'Greater Accra' };

  const http = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, as?: string, guestId?: string) => {
    let r = request(app.getHttpServer())[method](`/api/v1${url}`).set('X-Forwarded-For', ip()).set('X-Velora-Client', 'mobile');
    if (as) r = r.set('Authorization', `Bearer ${tokens[as]}`);
    if (guestId) r = r.set('X-Guest-Id', guestId);
    return r;
  };
  const login = async (email: string, password = DEMO) => (await http('post', '/auth/login').send({ email, password }).expect(200)).body.data.tokens.accessToken as string;
  const register = async (tag: string, extra: Record<string, unknown> = {}) => {
    const res = await http('post', '/auth/register').send({ email: `${tag}.${run}@example.test`, password: 'Growth-Pass-42', firstName: 'Ama', lastName: tag, ...extra });
    expect(res.status).toBe(201);
    tokens[tag] = res.body.data.tokens.accessToken;
    return res.body.data.user as { id: number; referralCode: string };
  };
  const balance = async (tag: string) => (await http('get', '/me/loyalty', tag)).body.data.pointsBalance as number;

  async function stockedVariant(slug: string, stock = 30) {
    const p = await prisma.product.findUniqueOrThrow({ where: { slug }, include: { variants: { orderBy: { id: 'asc' } } } });
    const v = p.variants[0];
    const def = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
    await prisma.inventory.updateMany({ where: { variantId: v.id }, data: { quantityOnHand: 0, quantityReserved: 0 } });
    await prisma.inventory.updateMany({ where: { variantId: v.id, warehouseId: def.id }, data: { quantityOnHand: stock } });
    return { product: p, variant: v };
  }

  /** Real checkout. `as` = a member token name; otherwise a guest with an email and phone. */
  async function checkout(variantId: number, opts: { as?: string; quantity?: number; redeemPoints?: number; expect?: number } = {}) {
    const g = opts.as ? undefined : `g_${randomBytes(12).toString('hex')}`;
    await http('post', '/cart/items', opts.as, g).send({ variantId, quantity: opts.quantity ?? 1 }).expect(201);
    const ship = await http('get', '/checkout/shipping-options?region=Greater%20Accra', opts.as, g);
    const res = await http('post', '/checkout/orders', opts.as, g).set('Idempotency-Key', randomUUID()).send({
      ...(!opts.as && { contact: { email: `guest.${randomBytes(3).toString('hex')}@example.test`, phone: '+233241112222' } }),
      address, shippingMethodId: ship.body.data[0].id, paymentMethod: 'CASH_ON_DELIVERY', redeemPoints: opts.redeemPoints,
    });
    expect(res.status).toBe(opts.expect ?? 201);
    if (res.status !== 201) await http('delete', `/cart/items/${(await http('get', '/cart', opts.as, g)).body.data.items[0].id}`, opts.as, g);
    return res.body.data;
  }
  const deliver = async (orderNumber: string) => {
    await http('post', `/admin/orders/${orderNumber}/ship`, 'orders').send({ carrier: 'VÉLORA Dispatch' }).expect(200);
    await http('post', `/admin/orders/${orderNumber}/deliver`, 'orders').expect(200);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ rawBody: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens.marketing = await login('marketing-manager@staff.velora.test');
    tokens.orders = await login('order-manager@staff.velora.test');
    tokens.support = await login('customer-support@staff.velora.test');
  });
  afterAll(() => app?.close());

  describe('promotions', () => {
    let promoId: number;
    let target: Awaited<ReturnType<typeof stockedVariant>>;

    it('only marketing can create promotions, with validated prices', async () => {
      target = await stockedVariant('oxford-cotton-shirt');
      const base = { name: `Flash ${run}`, type: 'FLASH_SALE', value: 20, startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() };
      await http('post', '/admin/promotions', 'support').send({ ...base, products: [{ productId: target.product.id }] }).expect(403);
      const tooHigh = await http('post', '/admin/promotions', 'marketing').send({ ...base, products: [{ productId: target.product.id, salePrice: '999.00' }] });
      expect(tooHigh.status).toBe(400);
      await http('post', '/admin/promotions', 'marketing').send({ ...base, endsAt: base.startsAt, products: [{ productId: target.product.id }] }).expect(400);
      const created = await http('post', '/admin/promotions', 'marketing').send({ ...base, products: [{ productId: target.product.id, stockLimit: 2 }] });
      expect(created.status).toBe(201);
      expect(created.body.data.state).toBe('LIVE');
      promoId = created.body.data.id;
    });

    it('applies the sale price everywhere it is shown and charged, until the allocation sells out', async () => {
      const list = Number(target.variant.price ?? target.product.basePrice);
      const sale = (Math.round(list * 0.8 * 100) / 100).toFixed(2);
      const detail = (await http('get', `/products/${target.product.slug}`)).body.data;
      expect(detail.price).toBe(sale);
      expect(detail.promotion).toMatchObject({ percentOff: 20, stockLeft: 2 });
      const listed = (await http('get', `/products?promotion=${(await prisma.promotion.findUniqueOrThrow({ where: { id: promoId } })).slug}`)).body.data;
      expect(listed.map((p: { slug: string; price: string }) => [p.slug, p.price])).toEqual([[target.product.slug, sale]]);

      const first = await checkout(target.variant.id, { quantity: 2 });
      expect(first.items[0].unitPrice).toBe(sale);
      expect((await prisma.orderItem.findFirstOrThrow({ where: { order: { orderNumber: first.orderNumber } } })).promotionId).toBe(promoId);

      // The 2-unit allocation is gone: the next shopper pays the list price.
      expect((await http('get', `/products/${target.product.slug}`)).body.data.price).toBe(list.toFixed(2));
      const second = await checkout(target.variant.id);
      expect(second.items[0].unitPrice).toBe(list.toFixed(2));

      // Cancelling the sale order returns its units to the flash sale.
      await http('post', `/admin/orders/${first.orderNumber}/cancel`, 'orders').send({ reason: 'Customer changed their mind' }).expect(200);
      expect((await prisma.promotionProduct.findFirstOrThrow({ where: { promotionId: promoId } })).soldCount).toBe(0);
      expect((await http('get', `/products/${target.product.slug}`)).body.data.price).toBe(sale);
    });

    it('pausing or ending a promotion restores list prices immediately', async () => {
      await http('post', `/admin/promotions/${promoId}/pause`, 'marketing').expect(200);
      expect((await http('get', `/products/${target.product.slug}`)).body.data.promotion).toBeNull();
      await http('post', `/admin/promotions/${promoId}/resume`, 'marketing').expect(200);
      expect((await http('get', `/products/${target.product.slug}`)).body.data.promotion).not.toBeNull();
      const ended = await http('post', `/admin/promotions/${promoId}/end`, 'marketing');
      expect(ended.body.data.state).toBe('ENDED');
      expect((await http('get', `/products/${target.product.slug}`)).body.data.promotion).toBeNull();
      const report = (await http('get', `/admin/promotions/${promoId}`, 'marketing')).body.data;
      expect(report.performance.unitsSold).toBe(0); // the only sale was cancelled
    });

    it('manages coupons: duplicates refused, used codes cannot be renamed', async () => {
      const code = `GROW${run}`.toUpperCase();
      const body = { code, type: 'PERCENTAGE', value: 10, description: 'Test' };
      await http('post', '/admin/coupons', 'marketing').send(body).expect(201);
      await http('post', '/admin/coupons', 'marketing').send(body).expect(409);
      await http('post', '/admin/coupons', 'marketing').send({ ...body, code: `${code}X`, value: 95 }).expect(400);
      const c = await prisma.coupon.findUniqueOrThrow({ where: { code } });
      await prisma.coupon.update({ where: { id: c.id }, data: { usedCount: 1 } });
      await http('patch', `/admin/coupons/${c.id}`, 'marketing').send({ ...body, code: `${code}NEW` }).expect(409);
      const off = await http('patch', `/admin/coupons/${c.id}`, 'marketing').send({ ...body, isActive: false });
      expect(off.body.data.isActive).toBe(false);
    });
  });

  describe('loyalty', () => {
    let variantId: number;
    let price: number;

    it('redeems points at checkout within the rules, and returns them on cancellation', async () => {
      await register('loyal');
      const t = await stockedVariant('slim-stretch-chinos');
      variantId = t.variant.id;
      price = Number(t.variant.price ?? t.product.basePrice);
      const me = (await http('get', '/auth/me', 'loyal')).body.data;
      await http('post', `/admin/customers/${me.id}/loyalty/adjust`, 'support').send({ points: 1000, reason: 'Goodwill gesture' }).expect(403);
      await http('post', `/admin/customers/${me.id}/loyalty/adjust`, 'marketing').send({ points: 1000, reason: 'Goodwill gesture' }).expect(200);
      expect(await balance('loyal')).toBe(1000);

      await http('post', '/cart/items', 'loyal').send({ variantId, quantity: 1 }).expect(201);
      const ship = (await http('get', '/checkout/shipping-options?region=Greater%20Accra', 'loyal')).body.data[0].id;
      const q = await http('post', '/checkout/quote', 'loyal').send({ region: 'Greater Accra', shippingMethodId: ship, redeemPoints: 400 });
      expect(q.status).toBe(200);
      expect(q.body.data.loyalty).toMatchObject({ balance: 1000, points: 400, value: '20.00' });
      expect(q.body.data.discountTotal).toBe('20.00');
      await http('post', '/checkout/quote', 'loyal').send({ region: 'Greater Accra', shippingMethodId: ship, redeemPoints: 50 }).expect(400); // below minimum
      const tooMany = await http('post', '/checkout/quote', 'loyal').send({ region: 'Greater Accra', shippingMethodId: ship, redeemPoints: 5000 });
      expect(tooMany.status).toBe(409);
      await http('delete', `/cart/items/${(await http('get', '/cart', 'loyal')).body.data.items[0].id}`, 'loyal');

      const o = await checkout(variantId, { as: 'loyal', redeemPoints: 400 });
      expect(o).toMatchObject({ loyaltyPointsUsed: 400, loyaltyDiscount: '20.00' });
      expect(await balance('loyal')).toBe(600);
      await http('post', `/me/orders/${o.orderNumber}/cancel`, 'loyal').send({}).expect(200);
      expect(await balance('loyal')).toBe(1000);
    });

    it('earns points on delivery for what was paid (not delivery, not points), and rewards a referral once', async () => {
      await register('referrer');
      const code = (await http('get', '/me/loyalty', 'referrer')).body.data.referral.code as string;
      await http('post', '/auth/register').send({ email: `bad.${run}@example.test`, password: 'Growth-Pass-42', firstName: 'A', lastName: 'B', referralCode: 'NOPE0000' }).expect(400);
      await register('friend', { referralCode: code });

      const o = await checkout(variantId, { as: 'friend' });
      await deliver(o.orderNumber);
      const merch = Number(o.grandTotal) - Number(o.shippingTotal);
      const friend = (await http('get', '/me/loyalty', 'friend')).body.data;
      expect(friend.pointsBalance).toBe(Math.floor(merch) + 250); // earned + welcome bonus
      expect((await http('get', '/me/loyalty', 'referrer')).body.data).toMatchObject({ pointsBalance: 500, referral: { invited: 1, rewarded: 1 } });

      const again = await checkout(variantId, { as: 'friend' });
      await deliver(again.orderNumber);
      expect(await balance('referrer')).toBe(500); // only the first delivered order counts
      const history = (await http('get', '/me/loyalty/transactions', 'friend')).body.data.map((t: { type: string }) => t.type);
      expect(history.filter((t: string) => t === 'REFERRAL_BONUS')).toHaveLength(1);
      expect(price).toBeGreaterThan(0);
    });
  });

  describe('reviews', () => {
    it('lets verified buyers review delivered items once; moderation publishes it and pays a bonus', async () => {
      await register('critic');
      const t = await stockedVariant('cropped-tailored-blazer');
      const pending = await checkout(t.variant.id, { as: 'critic' });
      const itemId = (await prisma.orderItem.findFirstOrThrow({ where: { order: { orderNumber: pending.orderNumber } } })).id;
      await http('post', '/me/reviews', 'critic').send({ orderItemId: itemId, rating: 5, body: 'Lovely fit and fabric.' }).expect(400); // not delivered yet

      await deliver(pending.orderNumber);
      const reviewable = (await http('get', '/me/reviewable', 'critic')).body.data;
      expect(reviewable.map((r: { orderItemId: number }) => r.orderItemId)).toContain(itemId);
      await http('post', '/me/reviews', 'critic').send({ orderItemId: itemId, rating: 0 }).expect(422);
      const created = await http('post', '/me/reviews', 'critic').send({ orderItemId: itemId, rating: 4, title: 'Sharp', body: 'Lovely fit, runs a little long.', fit: 'TRUE_TO_SIZE' });
      expect(created.status).toBe(201);
      expect(created.body.data.status).toBe('PENDING');
      await http('post', '/me/reviews', 'critic').send({ orderItemId: itemId, rating: 5 }).expect(409);

      const before = await prisma.product.findUniqueOrThrow({ where: { id: t.product.id } });
      const pts = await balance('critic');
      await http('post', `/admin/reviews/${created.body.data.id}/approve`, 'orders').expect(403);
      await http('post', `/admin/reviews/${created.body.data.id}/approve`, 'support').expect(200);
      await http('post', `/admin/reviews/${created.body.data.id}/approve`, 'support').expect(409);
      const after = await prisma.product.findUniqueOrThrow({ where: { id: t.product.id } });
      expect(after.reviewCount).toBe(before.reviewCount + 1);
      expect(await balance('critic')).toBe(pts + 50);
      // Rejecting and re-approving never pays the bonus twice.
      await http('post', `/admin/reviews/${created.body.data.id}/reject`, 'support').send({ reason: 'Test' }).expect(200);
      await http('post', `/admin/reviews/${created.body.data.id}/approve`, 'support').expect(200);
      expect(await balance('critic')).toBe(pts + 50);
    });
  });

  describe('search', () => {
    const names = async (q: string) => {
      const r = (await http('get', `/products?q=${encodeURIComponent(q)}&pageSize=5`)).body;
      return { names: r.data.map((p: { name: string }) => p.name) as string[], search: r.meta.search };
    };

    it('understands synonyms, plurals and misspellings, and ranks name matches first', async () => {
      expect((await names('trainers')).names).toContain('Leather Court Sneakers');
      expect((await names('chinos')).names[0]).toBe('Slim Stretch Chinos');
      const typo = await names('blazr');
      expect(typo.search).toMatchObject({ correctedFrom: 'blazr', query: 'blazer' });
      expect(typo.names).toContain('Cropped Tailored Blazer');
      expect((await names('zzqxv')).names).toEqual([]);
      expect((await http('get', '/search/suggest?q=snaekers')).body.data.didYouMean).toBe('sneaker');
    });
  });

  describe('messaging', () => {
    it('queues order emails and SMS in the same transaction, delivers them, and respects preferences', async () => {
      const messaging = app.get(MessagingService);
      const t = await stockedVariant('shea-glow-body-butter');
      const o = await checkout(t.variant.id);
      const rows = await prisma.messageOutbox.findMany({ where: { template: 'order.placed', OR: [{ subject: { contains: o.orderNumber } }, { body: { contains: o.orderNumber } }] } });
      expect(rows.map((r) => r.channel).sort()).toEqual(['EMAIL', 'SMS']);
      await messaging.flush(200);
      expect((await prisma.messageOutbox.findMany({ where: { id: { in: rows.map((r) => r.id) } } })).every((r) => r.status === 'SENT')).toBe(true);

      await register('quiet', { phone: `+23324${String(Date.now()).slice(-7)}` });
      await http('put', '/me/notification-preferences', 'quiet').send({ email: { orders: true, marketing: false }, sms: { orders: false, marketing: false } }).expect(200);
      const mine = await checkout(t.variant.id, { as: 'quiet' });
      const channels = (await prisma.messageOutbox.findMany({ where: { OR: [{ subject: { contains: mine.orderNumber } }, { body: { contains: mine.orderNumber } }] } })).map((r) => r.channel);
      expect(channels).toEqual(['EMAIL']);
      expect((await http('get', '/me/notifications', 'quiet')).body.data.map((n: { type: string }) => n.type)).toContain('order.placed');

      await http('post', '/admin/messages/broadcast', 'support').send({ channel: 'EMAIL', audience: 'all', subject: 'Hi', body: 'A new collection has landed.', dryRun: true }).expect(403);
      const dry = await http('post', '/admin/messages/broadcast', 'marketing').send({ channel: 'EMAIL', audience: 'all', subject: 'Hi', body: 'A new collection has landed.', dryRun: true });
      expect(dry.body.data.queued).toBe(0);
      expect(dry.body.data.recipients).toBeGreaterThanOrEqual(0);
    });
  });

  describe('analytics', () => {
    it('reports the funnel, search gaps and loyalty liability to analysts only', async () => {
      await http('get', '/admin/analytics', 'support').expect(403);
      const a = (await http('get', '/admin/analytics', 'marketing')).body.data;
      expect(a.funnel.steps.map((s: { step: string }) => s.step)).toEqual(['Viewed a product', 'Added to bag', 'Placed an order', 'Confirmed (paid or cash on delivery)', 'Delivered']);
      expect(a.search.zeroResults.map((s: { term: string }) => s.term)).toContain('zzqxv');
      expect(Number(a.loyalty.liability)).toBeGreaterThan(0);
    });
  });
});
