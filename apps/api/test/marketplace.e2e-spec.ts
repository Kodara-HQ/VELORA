import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

/** Phase 5 acceptance: vendor onboarding, vendor portal scoping, product review, commissions, settlements, suspension. */
describe('Marketplace (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seq = 0;
  const run = randomBytes(3).toString('hex');
  const ip = () => `10.50.${(seq >> 8) & 255}.${seq++ & 255}`;
  const DEMO = 'Test-Demo-Password-123';
  const tokens: Record<string, string> = {};
  const http = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, as?: string) => {
    let r = request(app.getHttpServer())[method](`/api/v1${url}`).set('X-Forwarded-For', ip()).set('X-Velora-Client', 'mobile');
    if (as) r = r.set('Authorization', `Bearer ${tokens[as]}`);
    return r;
  };
  const login = async (email: string, password = DEMO) => (await http('post', '/auth/login').send({ email, password }).expect(200)).body.data.tokens.accessToken as string;

  /** Registers a shopper, applies to sell, and has an admin approve them. */
  async function onboard(tag: string) {
    const email = `seller.${tag}.${run}@example.test`;
    const reg = await http('post', '/auth/register').send({ email, password: 'Seller-Pass-42', firstName: 'Seller', lastName: tag });
    tokens[tag] = reg.body.data.tokens.accessToken;
    const applied = await http('post', '/me/vendor-application', tag).send({
      businessName: `${tag} Studio ${run}`, contactPhone: '+233 24 555 0101', businessAddress: 'Osu, Accra, Greater Accra', productCategories: ['bags'],
      registrationNumber: 'cs123456789', about: 'Handmade accessories.',
    });
    expect(applied.status).toBe(201);
    expect(applied.body.data.application.status).toBe('SUBMITTED');
    const appId = applied.body.data.application.id;
    const approved = await http('post', `/admin/vendor-applications/${appId}/approve`, 'admin').send({ commissionRate: 10, notes: 'Documents verified' });
    expect(approved.status).toBe(200);
    return { appId, vendorId: approved.body.data.vendor.id as number, slug: approved.body.data.vendor.slug as string, email };
  }

  async function submitProduct(tag: string, name: string, opts: { stock?: Array<{ warehouseId: number; quantity: number }>; status?: string } = {}) {
    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'bags-clutches' } });
    const res = await http('post', '/vendor/products', tag).send({
      name: `${name} ${run}`, categoryId: cat.id, basePrice: '150.00', status: opts.status ?? 'ACTIVE', isFeatured: true, vendorId: 1,
      images: [{ url: 'https://placehold.co/800x1067/png' }],
      variants: [{ color: 'Black', colorHex: '#111111', size: 'One Size', stock: opts.stock ?? [] }],
    });
    expect(res.status).toBe(201);
    return res.body.data as { id: number; slug: string; status: string; vendorId: number; isFeatured: boolean; variants: Array<{ id: number; sku: string; inventory: Array<{ warehouse: { id: number }; onHand: number }> }> };
  }

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ rawBody: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens.admin = await login('admin@staff.velora.test');
    tokens.products = await login('product-manager@staff.velora.test');
    tokens.orders = await login('order-manager@staff.velora.test');
    tokens.finance = await login('finance-officer@staff.velora.test');
    tokens.support = await login('customer-support@staff.velora.test');
  });
  afterAll(() => app?.close());

  let A: Awaited<ReturnType<typeof onboard>>;
  let B: Awaited<ReturnType<typeof onboard>>;
  let product: Awaited<ReturnType<typeof submitProduct>>;

  it('onboards a vendor: application → approval → shop, stock location and portal access', async () => {
    A = await onboard('alpha');
    const me = (await http('get', '/auth/me', 'alpha')).body.data;
    expect(me.roles).toContain('vendor');
    expect(me.vendorId).toBe(A.vendorId);
    expect(me.permissions).toContain('vendor_portal.access');
    expect(await prisma.warehouse.count({ where: { vendorId: A.vendorId } })).toBe(1);
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: A.vendorId } })).commissionRate.toFixed(2)).toBe('10.00');
    const notes = (await http('get', '/me/notifications', 'alpha')).body.data.map((n: { type: string }) => n.type);
    expect(notes).toContain('vendor.approved');
    // Applying twice is refused.
    await http('post', '/me/vendor-application', 'alpha').send({ businessName: 'Again', contactPhone: '+233245550101', businessAddress: 'Accra Central', productCategories: [] }).expect(409);
    await http('post', `/admin/vendor-applications/${A.appId}/approve`, 'admin').send({}).expect(409);
  });

  it('refuses the portal to shoppers and staff without a shop', async () => {
    await http('get', '/vendor/dashboard', 'support').expect(403);
    const reg = await http('post', '/auth/register').send({ email: `shopper.${run}@example.test`, password: 'Shopper-Pass-42', firstName: 'Just', lastName: 'Shopping' });
    tokens.shopper = reg.body.data.tokens.accessToken;
    await http('get', '/vendor/dashboard', 'shopper').expect(403);
    await http('post', '/admin/vendor-applications/1/approve', 'support').send({}).expect(403);
  });

  it('vendor products always go to review; vendors cannot publish, feature, or stock other warehouses', async () => {
    const own = await prisma.warehouse.findFirstOrThrow({ where: { vendorId: A.vendorId } });
    const platform = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
    product = await submitProduct('alpha', 'Raffia Clutch', { stock: [{ warehouseId: own.id, quantity: 6 }, { warehouseId: platform.id, quantity: 500 }] });
    expect(product).toMatchObject({ status: 'PENDING_REVIEW', vendorId: A.vendorId, isFeatured: false });
    const inv = product.variants[0].inventory;
    expect(inv.find((i) => i.warehouse.id === own.id)!.onHand).toBe(6);
    expect(inv.find((i) => i.warehouse.id === platform.id)!.onHand).toBe(0);
    await http('get', `/products/${product.slug}`).expect(404);

    const approved = await http('post', `/admin/products/${product.id}/approve`, 'products');
    expect(approved.body.data.status).toBe('ACTIVE');
    await http('get', `/products/${product.slug}`).expect(200);
    expect((await http('get', '/me/notifications', 'alpha')).body.data.map((n: { type: string }) => n.type)).toContain('product.approved');

    // Editing a live product sends it back to review (and out of the store).
    const edit = await http('put', `/vendor/products/${product.id}`, 'alpha').send({
      name: `Raffia Clutch ${run}`, categoryId: approved.body.data.categoryId, basePrice: '120.00', status: 'ACTIVE',
      images: [{ url: 'https://placehold.co/800x1067/png' }], variants: product.variants.map((v) => ({ id: v.id, color: 'Black', size: 'One Size' })),
    });
    expect(edit.body.data.status).toBe('PENDING_REVIEW');
    await http('get', `/products/${product.slug}`).expect(404);
    await http('post', `/admin/products/${product.id}/approve`, 'products').expect(200);
    const listed = await http('get', `/products?vendor=${A.slug}`);
    expect(listed.body.data.map((p: { slug: string }) => p.slug)).toEqual([product.slug]);
  });

  it('isolates vendors from each other completely', async () => {
    B = await onboard('beta');
    await http('get', `/vendor/products/${product.id}`, 'beta').expect(404);
    await http('put', `/vendor/products/${product.id}`, 'beta').send({ name: 'Hijack', categoryId: 1, basePrice: '1.00', variants: [] }).expect(404);
    await http('post', `/vendor/products/${product.id}/archive`, 'beta').expect(404);
    await http('post', '/vendor/inventory/adjust', 'beta').send({ variantId: product.variants[0].id, delta: -6, note: 'Stealing stock' }).expect(404);
    expect((await http('get', '/vendor/products', 'beta')).body.data).toEqual([]);
    expect((await http('get', '/vendor/inventory', 'beta')).body.data).toEqual([]);
    // Even forged query params can't widen the scope.
    expect((await http('get', `/vendor/products?owner=${A.vendorId}`, 'beta')).body.data).toEqual([]);
  });

  let orderNumber: string;
  it('shows vendors only their own order lines, without customer contact details', async () => {
    const g = `g_${randomBytes(12).toString('hex')}`;
    const other = (await prisma.product.findUniqueOrThrow({ where: { slug: 'canvas-market-tote' }, include: { variants: true } })).variants[0];
    await prisma.inventory.updateMany({ where: { variantId: other.id }, data: { quantityOnHand: 20, quantityReserved: 0 } });
    for (const variantId of [product.variants[0].id, other.id]) {
      await http('post', '/cart/items').set('X-Guest-Id', g).send({ variantId, quantity: 1 }).expect(201);
    }
    const ship = await http('get', '/checkout/shipping-options?region=Greater%20Accra').set('X-Guest-Id', g);
    const placed = await http('post', '/checkout/orders').set('X-Guest-Id', g).set('Idempotency-Key', randomUUID()).send({
      contact: { email: `buyer.${run}@example.test`, phone: '+233241234567' },
      address: { recipientName: 'Abena Buyer', phone: '+233241234567', line1: '9 Secret Street', city: 'Labone, Accra', region: 'Greater Accra' },
      shippingMethodId: ship.body.data[0].id, paymentMethod: 'CASH_ON_DELIVERY',
    });
    expect(placed.status).toBe(201);
    orderNumber = placed.body.data.orderNumber;

    const mine = await http('get', `/vendor/orders/${orderNumber}`, 'alpha');
    expect(mine.status).toBe(200);
    expect(mine.body.data.lines).toHaveLength(1);
    expect(mine.body.data.lines[0].sku).toBe(product.variants[0].sku);
    expect(mine.body.data.totals).toMatchObject({ gross: '120.00', commission: '12.00', net: '108.00' }); // price edited to 120 and re-approved
    expect(mine.body.data.customer).toEqual({ firstName: 'Abena', city: 'Labone, Accra', region: 'Greater Accra' });
    expect(JSON.stringify(mine.body.data)).not.toMatch(/buyer\.|\+233241234567|Secret Street/);
    await http('get', `/vendor/orders/${orderNumber}`, 'beta').expect(404);
  });

  it('pays vendors through settlements only after the hold period, exactly once', async () => {
    await http('post', `/admin/orders/${orderNumber}/ship`, 'orders').send({ carrier: 'VÉLORA Dispatch' }).expect(200);
    await http('post', `/admin/orders/${orderNumber}/deliver`, 'orders').expect(200);
    const commission = await prisma.vendorCommission.findFirstOrThrow({ where: { vendorId: A.vendorId } });
    expect(commission.status).toBe('ELIGIBLE');
    expect(commission.eligibleAt!.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);

    await http('post', '/admin/settlements/generate', 'finance').send({ vendorId: A.vendorId }).expect(200);
    expect(await prisma.vendorSettlement.count({ where: { vendorId: A.vendorId } })).toBe(0); // still on hold

    await prisma.vendorCommission.update({ where: { id: commission.id }, data: { eligibleAt: new Date(Date.now() - 60_000) } });
    const payable = await http('get', '/admin/settlements/payable', 'finance').expect(200);
    expect(payable.body.data.find((p: { vendorId: number }) => p.vendorId === A.vendorId)).toMatchObject({ lines: 1, net: '108.00' });
    const gen =await http('post', '/admin/settlements/generate', 'finance').send({ vendorId: A.vendorId });
    expect(gen.body.data.created).toHaveLength(1);
    await http('post', '/admin/settlements/generate', 'finance').send({ vendorId: A.vendorId }).expect(200);
    expect(await prisma.vendorSettlement.count({ where: { vendorId: A.vendorId } })).toBe(1); // lines can't be claimed twice

    const s = await prisma.vendorSettlement.findFirstOrThrow({ where: { vendorId: A.vendorId } });
    expect(s.netAmount.toFixed(2)).toBe('108.00');
    await http('post', `/admin/settlements/${s.id}/pay`, 'finance').send({ payoutReference: 'MOMO-998877' }).expect(409); // not approved
    await http('post', `/admin/settlements/${s.id}/approve`, 'support').expect(403);
    await http('post', `/admin/settlements/${s.id}/approve`, 'finance').expect(200);
    await http('post', `/admin/settlements/${s.id}/pay`, 'finance').send({ payoutReference: 'MOMO-998877' }).expect(409); // no payout details yet
    await http('patch', '/vendor/profile', 'alpha').send({ payoutMethod: 'MOMO_MTN' }).expect(400); // method needs account details
    await http('patch', '/vendor/profile', 'alpha').send({ payoutMethod: 'MOMO_MTN', payoutDetails: { accountName: 'Alpha Owner', number: '+233244000099' } }).expect(200);
    const paid =await http('post', `/admin/settlements/${s.id}/pay`, 'finance').send({ payoutReference: 'MOMO-998877' });
    expect(paid.body.data.status).toBe('PAID');
    expect((await prisma.vendorCommission.findUniqueOrThrow({ where: { id: commission.id } })).status).toBe('SETTLED');

    // The vendor sees it; the other vendor can't.
    expect((await http('get', '/vendor/settlements', 'alpha')).body.data[0]).toMatchObject({ reference: s.reference, status: 'PAID', netAmount: '108.00' });
    await http('get', `/vendor/settlements/${s.id}`, 'beta').expect(404);
    const earnings = await http('get', '/vendor/earnings', 'alpha');
    expect(earnings.body.data.summary.settled).toBe('108.00');
    expect((await http('get', '/me/notifications', 'alpha')).body.data.map((n: { type: string }) => n.type)).toContain('vendor.payout');
  });

  it('suspension hides the shop and locks the portal immediately; reactivation restores both', async () => {
    await http('patch', `/admin/vendors/${A.vendorId}`, 'admin').send({ status: 'SUSPENDED' }).expect(400); // reason required
    await http('patch', `/admin/vendors/${A.vendorId}`, 'admin').send({ status: 'SUSPENDED', reason: 'Counterfeit complaint' }).expect(200);
    await http('get', `/vendors/${A.slug}`).expect(404);
    await http('get', `/products/${product.slug}`).expect(404);
    await http('get', '/vendor/dashboard', 'alpha').expect(403);

    await http('patch', `/admin/vendors/${A.vendorId}`, 'admin').send({ status: 'ACTIVE' }).expect(200);
    await http('get', `/vendors/${A.slug}`).expect(200);
    const dash = await http('get', '/vendor/dashboard', 'alpha');
    expect(dash.status).toBe(200);
    expect(dash.body.data.last30Days.orders).toBe(1);
  });

  it('lets vendors adjust stock only in their own location, with a ledger entry', async () => {
    const res = await http('post', '/vendor/inventory/adjust', 'alpha').send({ variantId: product.variants[0].id, delta: 4, note: 'New batch from workshop' });
    expect(res.status).toBe(201);
    const stock = await http('get', '/vendor/inventory', 'alpha');
    expect(stock.body.data[0].locations.find((l: { own: boolean }) => l.own).onHand).toBe(9); // 6 − 1 sold + 4
    expect(await prisma.stockMovement.count({ where: { note: 'Vendor: New batch from workshop', inventory: { variantId: product.variants[0].id } } })).toBe(1);
  });
});
