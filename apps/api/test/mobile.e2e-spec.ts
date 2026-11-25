import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationsService } from '../src/modules/notifications/notifications.module';

/** Phase 7 acceptance: the mobile client's session, push tokens and app notifications. */
describe('Mobile app API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seq = 0;
  const run = randomBytes(3).toString('hex');
  const ip = () => `10.70.${(seq >> 8) & 255}.${seq++ & 255}`;
  const token = (s: string) => `ExponentPushToken[${s}${run}abcdefgh]`;
  const http = (method: 'get' | 'post' | 'put', url: string, bearer?: string) => {
    let r = request(app.getHttpServer())[method](`/api/v1${url}`).set('X-Forwarded-For', ip()).set('X-Velora-Client', 'mobile');
    if (bearer) r = r.set('Authorization', `Bearer ${bearer}`);
    return r;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ rawBody: true }));
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app?.close());

  it('gives the app its refresh token in the body (no cookie) and rotates it', async () => {
    const reg = await http('post', '/auth/register').send({ email: `phone.${run}@example.test`, password: 'Mobile-Pass-42', firstName: 'Efua', lastName: 'Mobile' });
    expect(reg.status).toBe(201);
    expect(reg.headers['set-cookie']).toBeUndefined();
    const { refreshToken } = reg.body.data.tokens;
    expect(refreshToken).toEqual(expect.any(String));
    const next = await http('post', '/auth/refresh').send({ refreshToken });
    expect(next.status).toBe(200);
    await http('post', '/auth/refresh').send({ refreshToken }).expect(401); // reuse is refused
  });

  it('registers push tokens, moves them between accounts, and queues pushes for app notifications', async () => {
    const a = (await http('post', '/auth/register').send({ email: `pa.${run}@example.test`, password: 'Mobile-Pass-42', firstName: 'Ama', lastName: 'Push' })).body.data;
    const b = (await http('post', '/auth/register').send({ email: `pb.${run}@example.test`, password: 'Mobile-Pass-42', firstName: 'Kojo', lastName: 'Push' })).body.data;
    const A = a.tokens.accessToken as string;
    const B = b.tokens.accessToken as string;

    await http('post', '/me/push-tokens', A).send({ token: 'not-a-token', platform: 'android' }).expect(422);
    await http('post', '/me/push-tokens').send({ token: token('a'), platform: 'android' }).expect(401);
    await http('post', '/me/push-tokens', A).send({ token: token('a'), platform: 'android' }).expect(200);
    await http('post', '/me/push-tokens', A).send({ token: token('a'), platform: 'android' }).expect(200); // idempotent
    expect(await prisma.pushToken.count({ where: { token: token('a') } })).toBe(1);

    // A mobile order: recorded as a mobile sale, with a push queued alongside email.
    const p = await prisma.product.findUniqueOrThrow({ where: { slug: 'girls-tulle-party-dress' }, include: { variants: { orderBy: { id: 'asc' } } } });
    const def = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
    await prisma.inventory.updateMany({ where: { variantId: p.variants[0].id, warehouseId: def.id }, data: { quantityOnHand: 20 } });
    await http('post', '/cart/items', A).send({ variantId: p.variants[0].id, quantity: 1 }).expect(201);
    const ship = (await http('get', '/checkout/shipping-options?region=Greater%20Accra', A)).body.data[0].id;
    const order = await http('post', '/checkout/orders', A).set('Idempotency-Key', randomUUID()).send({
      address: { recipientName: 'Ama Push', phone: '+233241234567', line1: '1 App Street', city: 'Accra', region: 'Greater Accra' },
      shippingMethodId: ship, paymentMethod: 'CASH_ON_DELIVERY',
    });
    expect(order.status).toBe(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { orderNumber: order.body.data.orderNumber } });
    expect(o.channel).toBe('mobile');
    const push = await prisma.messageOutbox.findFirst({ where: { channel: 'PUSH', recipient: token('a'), template: 'order.placed' } });
    expect(push).not.toBeNull();
    expect(JSON.parse(push!.body).href).toBe(`/account/orders/${o.orderNumber}`);

    // Signing in as someone else on the same phone moves the token; the first user stops receiving pushes.
    await http('post', '/me/push-tokens', B).send({ token: token('a'), platform: 'android' }).expect(200);
    expect((await prisma.pushToken.findUniqueOrThrow({ where: { token: token('a') } })).userId).toBe(b.user.id);
    await http('post', '/me/push-tokens/remove', A).send({ token: token('a'), platform: 'android' }).expect(200);
    expect(await prisma.pushToken.count({ where: { token: token('a') } })).toBe(1); // A no longer owns it: not removed

    // Push can be switched off for order updates.
    await http('put', '/me/notification-preferences', B).send({ email: { orders: true, marketing: false }, sms: { orders: true, marketing: false }, push: { orders: false, marketing: false } }).expect(200);
    const notifications = app.get(NotificationsService);
    const pushes = () => prisma.messageOutbox.count({ where: { channel: 'PUSH', recipient: token('a') } });
    const before = await pushes();
    await notifications.notify(b.user.id, { type: 'test.ping', title: 'Hello', body: 'Silent', data: { href: '/account' } });
    expect(await pushes()).toBe(before); // bell only, no push
    await http('put', '/me/notification-preferences', B).send({ email: { orders: true, marketing: false }, sms: { orders: true, marketing: false }, push: { orders: true, marketing: false } }).expect(200);
    await notifications.notify(b.user.id, { type: 'test.ping', title: 'Hello', body: 'Loud', data: { href: '/account' } });
    expect(await pushes()).toBe(before + 1);

    await http('post', '/me/push-tokens/remove', B).send({ token: token('a'), platform: 'android' }).expect(200);
    expect(await prisma.pushToken.count({ where: { token: token('a') } })).toBe(0);
  });
});
