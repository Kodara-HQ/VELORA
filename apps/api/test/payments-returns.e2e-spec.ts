import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

/** Phase 4 acceptance: online payments, webhook verification, expiry, returns, exchanges and refunds. */
describe('Payments, returns & refunds (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seq = 0;
  const run = Date.now().toString(36);
  const ip = () => `10.40.${(seq >> 8) & 255}.${seq++ & 255}`;
  const DEMO = 'Test-Demo-Password-123';
  const PAYSTACK_SECRET = 'sk_test_e2e_only_not_a_real_key';
  const tokens: Record<string, string> = {};
  const address = { recipientName: 'Esi Test', phone: '+233241234567', line1: '3 Test Lane', city: 'Accra', region: 'Greater Accra' };

  const http = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, as?: string, guestId?: string) => {
    let r = request(app.getHttpServer())[method](`/api/v1${url}`).set('X-Forwarded-For', ip()).set('X-Velora-Client', 'mobile');
    if (as) r = r.set('Authorization', `Bearer ${tokens[as]}`);
    if (guestId) r = r.set('X-Guest-Id', guestId);
    return r;
  };
  const login = async (email: string, password = DEMO) => (await http('post', '/auth/login').send({ email, password }).expect(200)).body.data.tokens.accessToken as string;
  const reserved = async (variantId: number) => (await prisma.inventory.aggregate({ where: { variantId }, _sum: { quantityReserved: true } }))._sum.quantityReserved ?? 0;
  const onHand = async (variantId: number) => (await prisma.inventory.aggregate({ where: { variantId }, _sum: { quantityOnHand: true } }))._sum.quantityOnHand ?? 0;

  async function variant(slug: string, index = 0, stock = 20) {
    const v = (await prisma.product.findUniqueOrThrow({ where: { slug }, include: { variants: { orderBy: { id: 'asc' } } } })).variants[index];
    const def = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
    await prisma.inventory.updateMany({ where: { variantId: v.id }, data: { quantityOnHand: 0, quantityReserved: 0 } });
    await prisma.inventory.updateMany({ where: { variantId: v.id, warehouseId: def.id }, data: { quantityOnHand: stock } });
    return v;
  }

  /** Places an order through the real checkout. `as` = a token name for members, else a guest. */
  async function order(variantId: number, paymentMethod: string, opts: { as?: string; quantity?: number; key?: string } = {}) {
    const g = opts.as ? undefined : `g_${randomBytes(12).toString('hex')}`;
    await http('post', '/cart/items', opts.as, g).send({ variantId, quantity: opts.quantity ?? 1 }).expect(201);
    const ship = await http('get', '/checkout/shipping-options?region=Greater%20Accra', opts.as, g);
    const key = opts.key ?? randomUUID();
    const body = {
      ...(!opts.as && { contact: { email: `pay.${randomBytes(3).toString('hex')}@example.test`, phone: '+233241234567' } }),
      address, shippingMethodId: ship.body.data[0].id, paymentMethod,
    };
    const res = await http('post', '/checkout/orders', opts.as, g).set('Idempotency-Key', key).send(body);
    expect(res.status).toBe(201);
    return { ...res.body.data, guestId: g, key, body } as {
      orderNumber: string; status: string; nextAction: { url: string; reference: string } | null; guestId?: string; key: string;
      body: { contact?: { email: string } } & Record<string, unknown>; grandTotal: string;
    };
  }

  const signed = (payload: unknown) => {
    const raw = JSON.stringify(payload);
    return { raw, sig: createHmac('sha512', PAYSTACK_SECRET).update(raw).digest('hex') };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ rawBody: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens.orders = await login('order-manager@staff.velora.test');
    tokens.finance = await login('finance-officer@staff.velora.test');
    tokens.support = await login('customer-support@staff.velora.test');
    const reg = await http('post', '/auth/register').send({ email: `ret.${run}@example.test`, password: 'Shopper-Pass-42', firstName: 'Ret', lastName: 'Urner' });
    tokens.customer = reg.body.data.tokens.accessToken;
  });
  afterAll(() => app?.close());

  describe('online payments', () => {
    it('lists only configured methods', async () => {
      const codes = (await http('get', '/checkout/payment-methods')).body.data.map((m: { code: string }) => m.code);
      expect(codes).toEqual(['PAYSTACK', 'SIMULATOR', 'CASH_ON_DELIVERY']); // Hubtel has no keys in tests
    });

    it('holds stock while awaiting payment; a declined attempt can be retried and then paid exactly once', async () => {
      const v = await variant('canvas-market-tote');
      const o = await order(v.id, 'SIMULATOR');
      expect(o.status).toBe('PENDING_PAYMENT');
      expect(o.nextAction!.url).toMatch(/\/dev\/pay-simulator\?reference=VLP/);
      expect(await reserved(v.id)).toBe(1);
      const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber: o.orderNumber } });
      expect(row.paymentDueAt!.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);

      // Double-submitted checkout → same order, same payment page.
      const again = await http('post', '/checkout/orders', undefined, o.guestId).set('Idempotency-Key', o.key).send(o.body);
      expect(again.body.data.nextAction.reference).toBe(o.nextAction!.reference);

      // Coming back before deciding: still pending. The query string is never trusted.
      expect((await http('post', '/payments/verify').send({ reference: o.nextAction!.reference })).body.data.status).toBe('PENDING');

      const declined = await http('post', `/payments/simulator/${o.nextAction!.reference}`).send({ outcome: 'decline' });
      expect(declined.body.data).toMatchObject({ status: 'FAILED', orderStatus: 'PENDING_PAYMENT' });

      await http('post', `/orders/${o.orderNumber}/pay`).send({ provider: 'SIMULATOR', email: 'someone@else.test' }).expect(404); // not the owner
      const retry = await http('post', `/orders/${o.orderNumber}/pay`).send({ provider: 'SIMULATOR', email: o.body.contact!.email });
      expect(retry.status).toBe(200);
      expect(retry.body.data.reference).not.toBe(o.nextAction!.reference);

      const paid = await http('post', `/payments/simulator/${retry.body.data.reference}`).send({ outcome: 'approve', channel: 'momo' });
      expect(paid.body.data).toMatchObject({ status: 'SUCCESS', orderStatus: 'PAID', orderPaymentStatus: 'PAID' });
      await http('post', `/payments/simulator/${retry.body.data.reference}`).send({ outcome: 'approve' }).expect(200);
      expect(await prisma.payment.count({ where: { order: { orderNumber: o.orderNumber }, status: 'SUCCESS' } })).toBe(1);
      const p = await prisma.payment.findFirstOrThrow({ where: { reference: retry.body.data.reference } });
      expect(p.method).toBe('MOMO_MTN');

      // Paid orders are ready to ship.
      const shipped = await http('post', `/admin/orders/${o.orderNumber}/ship`, 'orders').send({ carrier: 'VÉLORA Dispatch' });
      expect(shipped.body.data.status).toBe('SHIPPED');
    });

    it('accepts only correctly signed Paystack webhooks, applies them once, and refuses amount mismatches', async () => {
      const v = await variant('satin-headwrap');
      const o = await order(v.id, 'SIMULATOR');
      // Treat this attempt as a Paystack transaction (no network call is made in the webhook path).
      await prisma.payment.update({ where: { reference: o.nextAction!.reference }, data: { provider: 'PAYSTACK' } });
      const amountMinor = Math.round(Number(o.grandTotal) * 100);
      const event = { event: 'charge.success', data: { id: Math.floor(Math.random() * 1e12), status: 'success', reference: o.nextAction!.reference, amount: amountMinor, currency: 'GHS', channel: 'card', authorization: { last4: '4081', brand: 'visa' } } };
      const { raw, sig } = signed(event);

      await http('post', '/payments/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', 'deadbeef').send(raw).expect(401);
      const tampered = JSON.stringify({ ...event, data: { ...event.data, amount: 1 } });
      await http('post', '/payments/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', sig).send(tampered).expect(401);

      const ok = await http('post', '/payments/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', sig).send(raw);
      expect(ok.status).toBe(200);
      const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber: o.orderNumber }, include: { payments: true } });
      expect(row).toMatchObject({ status: 'PAID', paymentStatus: 'PAID' });
      expect(row.payments.find((p) => p.reference === o.nextAction!.reference)).toMatchObject({ status: 'SUCCESS', method: 'CARD', cardLast4: '4081' });

      const replay = await http('post', '/payments/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', sig).send(raw);
      expect(replay.body.data).toEqual({ received: true, duplicate: true });

      // A correctly signed event for the wrong amount never marks an order paid.
      const v2 = await variant('velvet-matte-lipstick');
      const o2 = await order(v2.id, 'SIMULATOR');
      await prisma.payment.update({ where: { reference: o2.nextAction!.reference }, data: { provider: 'PAYSTACK' } });
      const bad = signed({ event: 'charge.success', data: { id: Math.floor(Math.random() * 1e12), status: 'success', reference: o2.nextAction!.reference, amount: 100, currency: 'GHS', channel: 'card' } });
      await http('post', '/payments/webhooks/paystack').set('Content-Type', 'application/json').set('x-paystack-signature', bad.sig).send(bad.raw).expect(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: o2.orderNumber } })).status).toBe('PENDING_PAYMENT');
      expect(await prisma.auditLog.count({ where: { action: 'payments.amount_mismatch', entityId: o2.nextAction!.reference } })).toBe(1);
    });

    it('cancels unpaid orders after the payment window and refunds a payment that arrives late', async () => {
      const v = await variant('gold-tone-layered-necklace', 0, 5);
      const o = await order(v.id, 'SIMULATOR');
      expect(await reserved(v.id)).toBe(1);
      await prisma.order.update({ where: { orderNumber: o.orderNumber }, data: { paymentDueAt: new Date(Date.now() - 60_000) } });

      const sweep = await http('post', '/admin/payments/sweep', 'orders').send({});
      expect(sweep.body.data.cancelled).toBeGreaterThanOrEqual(1);
      const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber: o.orderNumber }, include: { payments: true } });
      expect(row.status).toBe('CANCELLED');
      expect(row.payments[0].status).toBe('ABANDONED');
      expect(await reserved(v.id)).toBe(0);

      // The shopper completes payment anyway: money is never lost, it becomes a refund request.
      await prisma.payment.update({ where: { reference: o.nextAction!.reference }, data: { status: 'PENDING' } });
      await http('post', `/payments/simulator/${o.nextAction!.reference}`).send({ outcome: 'approve' }).expect(200);
      const refund = await prisma.refund.findFirstOrThrow({ where: { order: { orderNumber: o.orderNumber } } });
      expect(refund).toMatchObject({ status: 'REQUESTED', reason: 'Payment received after the order was cancelled' });
    });

    it('refunds an online payment through the gateway when a paid order is cancelled', async () => {
      const v = await variant('oversized-cat-eye-sunglasses');
      const o = await order(v.id, 'SIMULATOR', { as: 'customer' });
      await http('post', `/payments/simulator/${o.nextAction!.reference}`).send({ outcome: 'approve' }).expect(200);
      await http('post', `/me/orders/${o.orderNumber}/cancel`, 'customer').send({ reason: 'Ordered twice' }).expect(200);
      const list = await http('get', `/admin/refunds?q=${o.orderNumber}`, 'finance');
      const r = list.body.data[0];
      expect(r).toMatchObject({ status: 'REQUESTED', gatewayRefundable: true, amount: o.grandTotal });
      await http('post', `/admin/refunds/${r.id}/process`, 'support').send({ mode: 'GATEWAY' }).expect(403);
      const done = await http('post', `/admin/refunds/${r.id}/process`, 'finance').send({ mode: 'GATEWAY' });
      expect(done.body.data.status).toBe('COMPLETED');
      await http('post', `/admin/refunds/${r.id}/process`, 'finance').send({ mode: 'GATEWAY' }).expect(409);
      expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: o.orderNumber } })).paymentStatus).toBe('REFUNDED');
    });
  });

  describe('returns', () => {
    async function deliveredOrder(slug: string, quantity: number, index = 0) {
      const v = await variant(slug, index, 20);
      const o = await order(v.id, 'CASH_ON_DELIVERY', { as: 'customer', quantity });
      await http('post', `/admin/orders/${o.orderNumber}/ship`, 'orders').send({ carrier: 'VÉLORA Dispatch' }).expect(200);
      await http('post', `/admin/orders/${o.orderNumber}/deliver`, 'orders').expect(200);
      return { v, o };
    }

    it('return → approve → receive restocks and raises a refund for what was paid; Finance records the payout', async () => {
      const { v, o } = await deliveredOrder('heavyweight-boxy-tee', 2);
      const stockBefore = await onHand(v.id);
      const elig = await http('get', `/me/orders/${o.orderNumber}/returnable`, 'customer');
      expect(elig.body.data).toMatchObject({ eligible: true });
      expect(elig.body.data.lines[0]).toMatchObject({ sku: v.sku, returnable: 2 });

      await http('post', `/me/orders/${o.orderNumber}/returns`, 'customer').send({ type: 'RETURN', reason: 'WRONG_SIZE', items: [{ sku: v.sku, quantity: 3 }] }).expect(400);
      const req = await http('post', `/me/orders/${o.orderNumber}/returns`, 'customer').send({ type: 'RETURN', reason: 'WRONG_SIZE', note: 'Too boxy', items: [{ sku: v.sku, quantity: 1 }] });
      expect(req.status).toBe(201);
      const n = req.body.data.returnNumber;
      expect((await http('get', `/me/orders/${o.orderNumber}/returnable`, 'customer')).body.data.lines[0].returnable).toBe(1);

      await http('post', `/admin/returns/${n}/approve`, 'finance').send({}).expect(403);
      await http('post', `/admin/returns/${n}/receive`, 'support').send({ items: [{ returnItemId: 1, condition: 'RESELLABLE' }] }).expect(409); // not approved yet
      await http('post', `/admin/returns/${n}/approve`, 'support').send({}).expect(200);
      const itemId = (await http('get', `/admin/returns/${n}`, 'support')).body.data.items[0].id;
      const received = await http('post', `/admin/returns/${n}/receive`, 'support').send({ items: [{ returnItemId: itemId, condition: 'RESELLABLE' }] });
      expect(received.body.data).toMatchObject({ status: 'ITEMS_RECEIVED', refundAmount: '119.00' });
      expect(await onHand(v.id)).toBe(stockBefore + 1);

      const refund = (await http('get', `/admin/refunds?q=${o.orderNumber}`, 'finance')).body.data[0];
      expect(refund).toMatchObject({ amount: '119.00', gatewayRefundable: false, return: { returnNumber: n } });
      await http('post', `/admin/refunds/${refund.id}/process`, 'finance').send({ mode: 'GATEWAY' }).expect(400); // cash order
      await http('post', `/admin/refunds/${refund.id}/process`, 'finance').send({ mode: 'MANUAL', method: 'MOMO' }).expect(400);
      const paid = await http('post', `/admin/refunds/${refund.id}/process`, 'finance').send({ mode: 'MANUAL', method: 'MOMO', reference: 'MOMO-77123345' });
      expect(paid.body.data.status).toBe('COMPLETED');

      const after = await prisma.order.findUniqueOrThrow({ where: { orderNumber: o.orderNumber } });
      expect(after).toMatchObject({ status: 'PARTIALLY_REFUNDED', paymentStatus: 'PARTIALLY_REFUNDED' });
      expect(after.refundedTotal.toFixed(2)).toBe('119.00');
      expect((await http('get', `/me/returns/${n}`, 'customer')).body.data.status).toBe('REFUNDED');
      expect(await prisma.loyaltyTransaction.count({ where: { orderId: after.id, type: 'REVERSAL' } })).toBe(1);
    });

    it('exchange → receive creates a free replacement order with the new size reserved', async () => {
      const { v, o } = await deliveredOrder('relaxed-linen-shirt', 1, 0);
      const product = await prisma.product.findUniqueOrThrow({ where: { slug: 'relaxed-linen-shirt' }, include: { variants: { orderBy: { id: 'asc' } } } });
      const wanted = product.variants[1];
      await prisma.inventory.updateMany({ where: { variantId: wanted.id }, data: { quantityOnHand: 5, quantityReserved: 0 } });
      const req = await http('post', `/me/orders/${o.orderNumber}/returns`, 'customer').send({ type: 'EXCHANGE', reason: 'WRONG_SIZE', items: [{ sku: v.sku, quantity: 1, exchangeVariantId: wanted.id }] });
      expect(req.status).toBe(201);
      const n = req.body.data.returnNumber;
      await http('post', `/admin/returns/${n}/approve`, 'support').send({}).expect(200);
      const itemId = (await http('get', `/admin/returns/${n}`, 'support')).body.data.items[0].id;
      const res = await http('post', `/admin/returns/${n}/receive`, 'support').send({ items: [{ returnItemId: itemId, condition: 'RESELLABLE' }] });
      expect(res.body.data.status).toBe('EXCHANGED');
      const ret = await prisma.return.findUniqueOrThrow({ where: { returnNumber: n } });
      const replacement = await prisma.order.findUniqueOrThrow({ where: { id: ret.exchangeOrderId! }, include: { items: true } });
      expect(replacement).toMatchObject({ status: 'PROCESSING', paymentStatus: 'PAID', channel: 'exchange' });
      expect(replacement.grandTotal.toFixed(2)).toBe('0.00');
      expect(replacement.items[0].sku).toBe(wanted.sku);
      expect(await reserved(wanted.id)).toBe(1);
    });

    it('closes returns after the window and refuses undelivered orders', async () => {
      const { o } = await deliveredOrder('mudcloth-throw-cushion', 1);
      const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber: o.orderNumber } });
      await prisma.shipment.updateMany({ where: { orderId: row.id }, data: { deliveredAt: new Date(Date.now() - 30 * 86_400_000) } });
      const res = await http('get', `/me/orders/${o.orderNumber}/returnable`, 'customer');
      expect(res.body.data).toMatchObject({ eligible: false, reason: 'The 14-day return window has closed' });

      const v = await variant('canvas-market-tote');
      const open = await order(v.id, 'CASH_ON_DELIVERY', { as: 'customer' });
      const r2 = await http('post', `/me/orders/${open.orderNumber}/returns`, 'customer').send({ type: 'RETURN', reason: 'CHANGED_MIND', items: [{ sku: v.sku, quantity: 1 }] });
      expect(r2.status).toBe(409);
    });
  });
});
