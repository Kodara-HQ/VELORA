import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Phase 2 acceptance: catalogue, search, cart, coupons, checkout (idempotency, stock reservation,
 * no overselling under concurrency), guest→member cart merge, order history, cancellation, wishlist, addresses.
 */
describe('Storefront commerce (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ipSeq = 0;
  const run = Date.now().toString(36);
  const ip = () => `172.16.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
  const guest = () => `g_${randomBytes(12).toString('hex')}`;

  const http = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, opts: { guestId?: string; token?: string } = {}) => {
    let r = request(app.getHttpServer())[method](`/api/v1${url}`).set('X-Forwarded-For', ip()).set('X-Velora-Client', 'mobile');
    if (opts.guestId) r = r.set('X-Guest-Id', opts.guestId);
    if (opts.token) r = r.set('Authorization', `Bearer ${opts.token}`);
    return r;
  };

  const address = {
    recipientName: 'Ama Test', phone: '+233241234567', line1: '12 Ring Road', city: 'Osu, Accra', region: 'Greater Accra', digitalAddress: 'ga-183-8164',
  };

  /** Puts a variant into a known stock state: `onHand` in the default warehouse, 0 elsewhere, nothing reserved. */
  async function setStock(variantId: number, onHand: number) {
    const def = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
    await prisma.inventory.updateMany({ where: { variantId }, data: { quantityOnHand: 0, quantityReserved: 0 } });
    await prisma.inventory.updateMany({ where: { variantId, warehouseId: def.id }, data: { quantityOnHand: onHand } });
  }
  const reserved = async (variantId: number) =>
    (await prisma.inventory.aggregate({ where: { variantId }, _sum: { quantityReserved: true } }))._sum.quantityReserved ?? 0;

  async function variantOf(slug: string, index = 0) {
    const p = await prisma.product.findUniqueOrThrow({ where: { slug }, include: { variants: { orderBy: { id: 'asc' } } } });
    return p.variants[index];
  }

  async function shippingId(region = 'Greater Accra', guestId?: string, token?: string) {
    const res = await http('get', `/checkout/shipping-options?region=${encodeURIComponent(region)}`, { guestId, token });
    expect(res.status).toBe(200);
    return res.body.data.find((o: { code: string }) => o.code === 'standard').id as number;
  }

  async function registerCustomer(tag: string, guestId?: string) {
    const res = await http('post', '/auth/register', { guestId })
      .send({ email: `shop.${tag}.${run}@example.test`, password: 'Shopper-Pass-42', firstName: 'Shop', lastName: tag });
    expect(res.status).toBe(201);
    return { token: res.body.data.tokens.accessToken as string, email: res.body.data.user.email as string };
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app?.close());

  describe('catalogue', () => {
    it('lists a department including its sub-categories, sorted by price', async () => {
      const res = await http('get', '/products?category=womens-fashion&sort=price_asc&pageSize=50');
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(7);
      const prices = res.body.data.map((p: { price: string }) => Number(p.price));
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
      expect(res.body.data[0]).toEqual(expect.objectContaining({ slug: expect.any(String), image: expect.any(Object), colors: expect.any(Array) }));
    });

    it('filters by brand, colour, size, price and sale', async () => {
      const res = await http('get', '/products?brand=maison-noir&onSale=true&maxPrice=400');
      expect(res.status).toBe(200);
      for (const p of res.body.data) {
        expect(p.brand.slug).toBe('maison-noir');
        expect(p.compareAtPrice).not.toBeNull();
        expect(Number(p.price)).toBeLessThanOrEqual(400);
      }
      const sized = await http('get', '/products?category=shoes&size=44');
      expect(sized.body.data.map((p: { slug: string }) => p.slug)).toEqual(['leather-court-sneakers']);
    });

    it('returns facets, product detail with per-variant stock, and 404 for unknown products', async () => {
      const f = await http('get', '/products/facets?category=womens-fashion');
      expect(f.body.data.sizes.map((s: { name: string }) => s.name).slice(0, 3)).toEqual(['XS', 'S', 'M']);
      const d = await http('get', '/products/satin-wrap-midi-dress');
      expect(d.status).toBe(200);
      expect(d.body.data.variants[0]).toEqual(expect.objectContaining({ sku: expect.any(String), available: expect.any(Number) }));
      expect(d.body.data.sizeGuide.columns).toContain('Bust');
      await http('get', '/products/does-not-exist').expect(404);
    });

    it('searches across name, brand and category, records trending terms, and suggests', async () => {
      const term = `kente`;
      const before = await prisma.searchTerm.findUnique({ where: { term } });
      const res = await http('get', `/products?q=${term}`);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(2);
      await new Promise((r) => setTimeout(r, 150));
      const after = await prisma.searchTerm.findUniqueOrThrow({ where: { term } });
      expect(after.searchCount).toBe((before?.searchCount ?? 0) + 1);
      const s = await http('get', '/search/suggest?q=snea');
      expect(s.body.data.products[0].slug).toBe('leather-court-sneakers');
      expect((await http('get', '/search/trending')).body.data).toContain('kente');
    });

    it('tracks recently viewed products for guests and personalises recommendations', async () => {
      const g = guest();
      const p = await prisma.product.findUniqueOrThrow({ where: { slug: 'leather-court-sneakers' } });
      await http('post', `/products/${p.id}/views`, { guestId: g }).expect(200);
      const recent = await http('get', '/recently-viewed', { guestId: g });
      expect(recent.body.data.map((x: { slug: string }) => x.slug)).toEqual(['leather-court-sneakers']);
      const recs = await http('get', '/recommendations', { guestId: g });
      expect(recs.body.data).toHaveLength(8);
      expect(recs.body.data.map((x: { slug: string }) => x.slug)).not.toContain('leather-court-sneakers');
    });
  });

  describe('cart', () => {
    it('requires a guest id or a session', async () => {
      const v = await variantOf('canvas-market-tote');
      await http('post', '/cart/items').send({ variantId: v.id, quantity: 1 }).expect(400);
    });

    it('caps quantity at available stock and rejects sold-out variants', async () => {
      const v = await variantOf('oversized-cat-eye-sunglasses');
      await setStock(v.id, 3);
      const g = guest();
      const res = await http('post', '/cart/items', { guestId: g }).send({ variantId: v.id, quantity: 5 });
      expect(res.status).toBe(201);
      expect(res.body.data.items[0].quantity).toBe(3);
      expect(res.body.data.notice).toMatch(/Only 3/);

      const soldOut = await variantOf('oversized-cat-eye-sunglasses', 1);
      await setStock(soldOut.id, 0);
      const r2 = await http('post', '/cart/items', { guestId: g }).send({ variantId: soldOut.id, quantity: 1 });
      expect(r2.status).toBe(409);
      expect(r2.body.error.code).toBe('OUT_OF_STOCK');
    });

    it('keeps carts private: another guest cannot touch my items', async () => {
      const v = await variantOf('canvas-market-tote');
      await setStock(v.id, 20);
      const mine = await http('post', '/cart/items', { guestId: guest() }).send({ variantId: v.id, quantity: 1 });
      const itemId = mine.body.data.items[0].id;
      await http('delete', `/cart/items/${itemId}`, { guestId: guest() }).expect(404);
    });

    it('validates coupons: unknown, minimum spend, then a valid percentage code', async () => {
      const v = await variantOf('canvas-market-tote');
      await setStock(v.id, 20);
      const g = guest();
      await http('post', '/cart/items', { guestId: g }).send({ variantId: v.id, quantity: 1 });
      const unknown = await http('post', '/cart/coupon', { guestId: g }).send({ code: 'NOPE123' });
      expect(unknown.status).toBe(400);
      const min = await http('post', '/cart/coupon', { guestId: g }).send({ code: 'style50' });
      expect(min.status).toBe(400);
      expect(min.body.error.message).toMatch(/Spend GH₵400\.00/);
      const ok = await http('post', '/cart/coupon', { guestId: g }).send({ code: 'akwaaba10' });
      expect(ok.status).toBe(200);
      expect(ok.body.data.coupon).toMatchObject({ code: 'AKWAABA10', valid: true, discount: '13.90' });
      expect(ok.body.data.estimatedTotal).toBe('125.10');
    });
  });

  describe('checkout', () => {
    it('places a guest cash-on-delivery order, reserves stock, and is idempotent on retry', async () => {
      const v = await variantOf('structured-top-handle-bag');
      await setStock(v.id, 10);
      const g = guest();
      await http('post', '/cart/items', { guestId: g }).send({ variantId: v.id, quantity: 2 });
      const shipId = await shippingId('Greater Accra', g);
      const quote = await http('post', '/checkout/quote', { guestId: g }).send({ region: 'Greater Accra', shippingMethodId: shipId });
      expect(quote.body.data).toMatchObject({ subtotal: '1120.00', shippingTotal: '0.00', grandTotal: '1120.00' }); // free over GH₵500

      const key = randomUUID();
      const body = {
        contact: { email: `guest.${run}@example.test`, phone: '+233 24 123 4567' }, address,
        shippingMethodId: shipId, paymentMethod: 'CASH_ON_DELIVERY', expectedTotal: quote.body.data.grandTotal,
      };
      const first = await http('post', '/checkout/orders', { guestId: g }).set('Idempotency-Key', key).send(body);
      expect(first.status).toBe(201);
      expect(first.body.data).toMatchObject({ status: 'PROCESSING', paymentStatus: 'PENDING', grandTotal: '1120.00', itemCount: 2, canCancel: true });
      expect(first.body.data.orderNumber).toMatch(/^VL\d{6}[A-Z2-9]{5}$/);
      expect(first.body.data.shippingAddress.digitalAddress).toBe('GA-183-8164');
      expect(await reserved(v.id)).toBe(2);

      const retry = await http('post', '/checkout/orders', { guestId: g }).set('Idempotency-Key', key).send(body);
      expect(retry.status).toBe(201);
      expect(retry.body.data.orderNumber).toBe(first.body.data.orderNumber);
      expect(await reserved(v.id)).toBe(2); // not reserved twice
      expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(1);

      expect((await http('get', '/cart', { guestId: g })).body.data.itemCount).toBe(0);
      const movements = await prisma.stockMovement.count({ where: { referenceType: 'order', referenceId: (await prisma.order.findUniqueOrThrow({ where: { idempotencyKey: key } })).id, type: 'RESERVATION' } });
      expect(movements).toBeGreaterThanOrEqual(1);

      const look = await http('post', '/orders/lookup').send({ orderNumber: first.body.data.orderNumber, email: body.contact.email });
      expect(look.status).toBe(200);
      await http('post', '/orders/lookup').send({ orderNumber: first.body.data.orderNumber, email: 'someone.else@example.test' }).expect(404);
    });

    it('refuses without an idempotency key, and when the price changed since the shopper saw it', async () => {
      const v = await variantOf('canvas-market-tote');
      await setStock(v.id, 20);
      const g = guest();
      await http('post', '/cart/items', { guestId: g }).send({ variantId: v.id, quantity: 1 });
      const shipId = await shippingId('Ashanti', g);
      const base = { contact: { email: `price.${run}@example.test`, phone: '+233241234567' }, address: { ...address, region: 'Ashanti', city: 'Kumasi' }, shippingMethodId: shipId, paymentMethod: 'CASH_ON_DELIVERY' };
      const noKey = await http('post', '/checkout/orders', { guestId: g }).send(base);
      expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      const changed = await http('post', '/checkout/orders', { guestId: g }).set('Idempotency-Key', randomUUID()).send({ ...base, expectedTotal: '1.00' });
      expect(changed.status).toBe(409);
      expect(changed.body.error.code).toBe('PRICE_CHANGED');
      expect(changed.body.error.details.grandTotal).toBe('174.00'); // 139 + 35 Ashanti delivery
      const wrongRegion = await http('post', '/checkout/orders', { guestId: g }).set('Idempotency-Key', randomUUID()).send({ ...base, address });
      expect(wrongRegion.body.error.code).toBe('SHIPPING_UNAVAILABLE'); // Ashanti method, Accra address
    });

    it('never oversells: two shoppers racing for the last unit → exactly one order', async () => {
      const v = await variantOf('gold-tone-layered-necklace');
      await setStock(v.id, 1);
      const shoppers = [guest(), guest()];
      for (const g of shoppers) await http('post', '/cart/items', { guestId: g }).send({ variantId: v.id, quantity: 1 }).expect(201);
      const shipId = await shippingId('Greater Accra', shoppers[0]);
      const results = await Promise.all(shoppers.map((g, i) =>
        http('post', '/checkout/orders', { guestId: g }).set('Idempotency-Key', randomUUID())
          .send({ contact: { email: `race${i}.${run}@example.test`, phone: '+233241234567' }, address, shippingMethodId: shipId, paymentMethod: 'CASH_ON_DELIVERY' })));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      expect(await reserved(v.id)).toBe(1);
      const loser = results.find((r) => r.status === 409)!;
      expect(loser.body.error.code).toBe('INSUFFICIENT_STOCK');
    });
  });

  describe('member account', () => {
    it('merges the guest bag into the account on sign-up', async () => {
      const v = await variantOf('satin-headwrap');
      await setStock(v.id, 10);
      const g = guest();
      await http('post', '/cart/items', { guestId: g }).send({ variantId: v.id, quantity: 2 });
      const { token } = await registerCustomer('merge', g);
      const cart = await http('get', '/cart', { token });
      expect(cart.body.data.items).toEqual([expect.objectContaining({ variantId: v.id, quantity: 2 })]);
      expect((await http('get', '/cart', { guestId: g })).body.data.itemCount).toBe(0);
    });

    it('saves addresses with a single default, orders with a saved address, lists and cancels orders', async () => {
      const { token } = await registerCustomer('orders');
      const a1 = await http('post', '/me/addresses', { token }).send(address);
      expect(a1.body.data.isDefault).toBe(true);
      const a2 = await http('post', '/me/addresses', { token }).send({ ...address, label: 'Office', isDefault: true });
      const list = (await http('get', '/me/addresses', { token })).body.data;
      expect(list.filter((a: { isDefault: boolean }) => a.isDefault)).toEqual([expect.objectContaining({ id: a2.body.data.id })]);
      await http('post', '/me/addresses', { token }).send({ ...address, region: 'Atlantis' }).expect(422);

      const v = await variantOf('velvet-matte-lipstick');
      await setStock(v.id, 10);
      await http('post', '/cart/items', { token }).send({ variantId: v.id, quantity: 3 });
      await http('post', '/cart/coupon', { token }).send({ code: 'AKWAABA10' }).expect(200);
      const order = await http('post', '/checkout/orders', { token }).set('Idempotency-Key', randomUUID())
        .send({ addressId: a2.body.data.id, shippingMethodId: await shippingId('Greater Accra', undefined, token), paymentMethod: 'CASH_ON_DELIVERY' });
      expect(order.status).toBe(201);
      expect(order.body.data).toMatchObject({ couponCode: 'AKWAABA10', subtotal: '237.00', discountTotal: '23.70', shippingTotal: '25.00', grandTotal: '238.30' });
      const coupon = await prisma.coupon.findUniqueOrThrow({ where: { code: 'AKWAABA10' } });
      expect(await reserved(v.id)).toBe(3);

      const orders = await http('get', '/me/orders', { token });
      expect(orders.body.data[0]).toMatchObject({ orderNumber: order.body.data.orderNumber, itemCount: 3 });

      // First-order coupon can't be reused while that order stands.
      await http('post', '/cart/items', { token }).send({ variantId: v.id, quantity: 1 });
      const reuse = await http('post', '/cart/coupon', { token }).send({ code: 'AKWAABA10' });
      expect(reuse.body.error.message).toMatch(/first orders only/);

      const cancelled = await http('post', `/me/orders/${order.body.data.orderNumber}/cancel`, { token }).send({ reason: 'Changed my mind' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', canCancel: false });
      expect(await reserved(v.id)).toBe(0);
      expect((await prisma.coupon.findUniqueOrThrow({ where: { code: 'AKWAABA10' } })).usedCount).toBe(coupon.usedCount - 1);
      await http('post', `/me/orders/${order.body.data.orderNumber}/cancel`, { token }).send({}).expect(409);
    });

    it("never exposes another customer's order", async () => {
      const a = await registerCustomer('owner');
      const b = await registerCustomer('snoop');
      const v = await variantOf('canvas-market-tote');
      await setStock(v.id, 20);
      await http('post', '/cart/items', { token: a.token }).send({ variantId: v.id, quantity: 1 });
      const order = await http('post', '/checkout/orders', { token: a.token }).set('Idempotency-Key', randomUUID())
        .send({ address, shippingMethodId: await shippingId('Greater Accra', undefined, a.token), paymentMethod: 'CASH_ON_DELIVERY' });
      expect(order.status).toBe(201);
      await http('get', `/me/orders/${order.body.data.orderNumber}`, { token: b.token }).expect(404);
      await http('post', `/me/orders/${order.body.data.orderNumber}/cancel`, { token: b.token }).send({}).expect(404);
    });

    it('manages the wishlist', async () => {
      const { token } = await registerCustomer('wish');
      const p = await prisma.product.findUniqueOrThrow({ where: { slug: 'shea-glow-body-butter' } });
      expect((await http('post', '/me/wishlist/items', { token }).send({ productId: p.id })).body.data).toEqual([p.id]);
      await http('post', '/me/wishlist/items', { token }).send({ productId: p.id }); // idempotent
      const list = await http('get', '/me/wishlist', { token });
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].product.slug).toBe('shea-glow-body-butter');
      expect((await http('delete', `/me/wishlist/items/${p.id}`, { token })).body.data).toEqual([]);
      await http('get', '/me/wishlist').expect(401);
    });
  });
});
