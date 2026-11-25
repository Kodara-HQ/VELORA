import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';

/** Phase 3 acceptance: administration — dashboard, catalogue, inventory, fulfilment, customers, reports, RBAC. */
describe('Administration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seq = 0;
  const run = Date.now().toString(36).toUpperCase();
  const ip = () => `192.168.${(seq >> 8) & 255}.${seq++ & 255}`;
  const DEMO = 'Test-Demo-Password-123';
  const tokens: Record<string, string> = {};

  const http = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, as?: string) => {
    let r = request(app.getHttpServer())[method](`/api/v1${url}`).set('X-Forwarded-For', ip()).set('X-Velora-Client', 'mobile');
    if (as) r = r.set('Authorization', `Bearer ${tokens[as]}`);
    return r;
  };
  const login = async (email: string, password = DEMO) => {
    const res = await http('post', '/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.data.tokens.accessToken as string;
  };
  const onHand = async (variantId: number) => (await prisma.inventory.aggregate({ where: { variantId }, _sum: { quantityOnHand: true } }))._sum.quantityOnHand ?? 0;
  const reserved = async (variantId: number) => (await prisma.inventory.aggregate({ where: { variantId }, _sum: { quantityReserved: true } }))._sum.quantityReserved ?? 0;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication({ rawBody: true }));
    await app.init();
    prisma = app.get(PrismaService);
    tokens.super = await login('admin@velora.test', 'Test-Super-Admin-123');
    for (const r of ['admin', 'product-manager', 'inventory-manager', 'order-manager', 'finance-officer', 'customer-support', 'warehouse-officer']) {
      tokens[r] = await login(`${r}@staff.velora.test`);
    }
    const reg = await http('post', '/auth/register').send({ email: `adm.cust.${run}@example.test`, password: 'Shopper-Pass-42', firstName: 'Ad', lastName: 'Min' });
    tokens.customer = reg.body.data.tokens.accessToken;
  });
  afterAll(() => app?.close());

  /** Places a real guest order through checkout and returns its number. */
  async function placeOrder(variantId: number, quantity = 1) {
    const g = `g_${randomBytes(12).toString('hex')}`;
    await http('post', '/cart/items').set('X-Guest-Id', g).send({ variantId, quantity }).expect(201);
    const opts = await http('get', '/checkout/shipping-options?region=Greater%20Accra').set('X-Guest-Id', g);
    const res = await http('post', '/checkout/orders').set('X-Guest-Id', g).set('Idempotency-Key', randomUUID()).send({
      contact: { email: `adm.order.${randomBytes(3).toString('hex')}@example.test`, phone: '+233241234567' },
      address: { recipientName: 'Kofi Test', phone: '+233241234567', line1: '1 Test Road', city: 'Accra', region: 'Greater Accra' },
      shippingMethodId: opts.body.data[0].id, paymentMethod: 'CASH_ON_DELIVERY',
    });
    expect(res.status).toBe(201);
    return res.body.data.orderNumber as string;
  }

  async function stockedVariant(slug: string, qty = 20) {
    const v = (await prisma.product.findUniqueOrThrow({ where: { slug }, include: { variants: { orderBy: { id: 'asc' }, take: 1 } } })).variants[0];
    const def = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
    await prisma.inventory.updateMany({ where: { variantId: v.id }, data: { quantityOnHand: 0, quantityReserved: 0 } });
    await prisma.inventory.updateMany({ where: { variantId: v.id, warehouseId: def.id }, data: { quantityOnHand: qty } });
    return v;
  }

  describe('access control', () => {
    it.each([
      ['customer', 'get', '/admin/dashboard'],
      ['customer-support', 'get', '/admin/dashboard'],
      ['warehouse-officer', 'post', '/admin/products'],
      ['product-manager', 'post', '/admin/inventory/adjust'],
      ['customer-support', 'patch', '/admin/customers/1/status'],
      ['inventory-manager', 'get', '/admin/orders'],
      ['order-manager', 'get', '/admin/reports/sales'],
    ])('%s is refused %s %s', async (who, method, url) => {
      const res = await http(method as 'get', url, who).send({});
      expect(res.status).toBe(403);
    });

    it('requires authentication for every admin route', async () => {
      await http('get', '/admin/orders').expect(401);
      await http('get', '/admin/inventory').expect(401);
    });
  });

  describe('dashboard & reports', () => {
    it('returns KPIs, a gap-free daily series, best sellers and alerts', async () => {
      const res = await http('get', '/admin/dashboard?from=2000-01-01&to=2099-01-01', 'admin');
      expect(res.status).toBe(400); // more than two years
      const ok = await http('get', '/admin/dashboard', 'admin');
      expect(ok.status).toBe(200);
      const d = ok.body.data;
      expect(Number(d.kpis.revenue.value)).toBeGreaterThan(0);
      expect(d.series).toHaveLength(d.range.days);
      expect(d.bestSellers.length).toBeGreaterThan(0);
      expect(d.recentOrders.length).toBeGreaterThan(0);
      expect(d.kpis).toHaveProperty('averageOrderValue.change');
    });

    it('scopes KPIs to a category', async () => {
      const all = (await http('get', '/admin/dashboard', 'admin')).body.data.kpis.revenue.value;
      const shoes = await prisma.category.findUniqueOrThrow({ where: { slug: 'shoes' } });
      const scoped = (await http('get', `/admin/dashboard?categoryId=${shoes.id}`, 'admin')).body.data;
      expect(Number(scoped.kpis.revenue.value)).toBeLessThan(Number(all));
      expect(scoped.topCategories.every((c: { name: string }) => c.name === 'Shoes')).toBe(true);
    });

    it('exports the sales report as safe CSV for finance', async () => {
      const res = await http('get', '/admin/reports/sales?groupBy=week&format=csv', 'finance-officer');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text).toMatch(/Period,Orders,Units/);
      const json = await http('get', '/admin/reports/sales?groupBy=month', 'finance-officer');
      expect(json.body.data.rows.length).toBeGreaterThan(0);
    });

    it('serves notification counts for the top bar', async () => {
      const res = await http('get', '/admin/notifications', 'order-manager');
      expect(res.body.data).toEqual(expect.objectContaining({ ordersToFulfil: expect.any(Number), lowStockVariants: expect.any(Number) }));
    });
  });

  describe('catalogue management', () => {
    it('creates a product with variants and opening stock, publishes it, and it appears in the storefront', async () => {
      const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'bags-clutches' } });
      const wh = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
      const name = `Beaded Evening Clutch ${run}`;
      const created = await http('post', '/admin/products', 'product-manager').send({
        name, categoryId: cat.id, basePrice: '189.00', compareAtPrice: '159.00', status: 'DRAFT',
        variants: [{ color: 'Gold', colorHex: '#D4AF37', size: 'One Size', stock: [{ warehouseId: wh.id, quantity: 7 }] }],
      });
      expect(created.status).toBe(400); // compare-at lower than price

      const ok = await http('post', '/admin/products', 'product-manager').send({
        name, categoryId: cat.id, basePrice: '189.00', compareAtPrice: '229.00', status: 'DRAFT', shortDescription: 'Hand-beaded.',
        attributes: [{ name: 'Origin', value: 'Made in Ghana' }],
        variants: [
          { color: 'Gold', colorHex: '#D4AF37', size: 'One Size', costPrice: '80.00', stock: [{ warehouseId: wh.id, quantity: 7 }] },
          { color: 'Silver', colorHex: '#C0C0C0', size: 'One Size' },
        ],
      });
      expect(ok.status).toBe(201);
      const p = ok.body.data;
      expect(p.styleCode).toMatch(/^VL-\d+$/);
      expect(p.variants).toHaveLength(2);
      expect(p.variants[0].sku).toBe(`${p.styleCode}-GOLD-ONESIZE`);
      expect(p.variants[0].inventory.find((i: { warehouse: { id: number } }) => i.warehouse.id === wh.id).onHand).toBe(7);

      // Draft products are invisible to shoppers; publishing needs an image.
      await http('get', `/products/${p.slug}`).expect(404);
      const noImage = await http('post', `/admin/products/${p.id}/publish`, 'product-manager');
      expect(noImage.status).toBe(400);
      await http('put', `/admin/products/${p.id}`, 'product-manager').send({
        name, categoryId: cat.id, basePrice: '189.00', compareAtPrice: '229.00',
        images: [{ url: 'https://placehold.co/800x1067/png', color: 'Gold' }],
        variants: p.variants.map((v: { id: number; color: string; size: string }) => ({ id: v.id, color: v.color, size: v.size })),
      }).expect(200);
      await http('post', `/admin/products/${p.id}/publish`, 'product-manager').expect(200);
      const store = await http('get', `/products/${p.slug}`);
      expect(store.status).toBe(200);
      expect(store.body.data.variants.find((v: { color: string }) => v.color === 'Gold').available).toBe(7);

      const audit = await prisma.auditLog.count({ where: { entityType: 'product', entityId: String(p.id), action: 'products.created' } });
      expect(audit).toBe(1);

      // Archiving removes it from the storefront again.
      await http('post', `/admin/products/${p.id}/archive`, 'product-manager').expect(200);
      await http('get', `/products/${p.slug}`).expect(404);
    });

    it('exports CSV and validates an import without writing on a dry run', async () => {
      const csv = await http('get', '/admin/products/export.csv', 'product-manager');
      expect(csv.status).toBe(200);
      const lines = csv.text.replace(/^﻿/, '').split('\r\n');
      expect(lines[0]).toBe('style_code,name,slug,category_slug,brand,status,base_price,compare_at_price,material,short_description,sku,color,color_hex,size,variant_price,cost_price,variant_active,stock_on_hand');
      const tote = lines.filter((l) => l.includes('canvas-market-tote'));
      const changed = [lines[0], ...tote.map((l) => l.replace(',139.00,', ',149.00,'))].join('\n') + '\nVL-BAD,,x,nope,,ACTIVE,abc,,,,SKU1,,,,,,,\n';
      const res = await http('post', '/admin/products/import?dryRun=true', 'product-manager').attach('file', Buffer.from(changed), 'products.csv');
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ dryRun: true, updated: 1, created: 0 });
      expect(res.body.data.errors.length).toBe(1);
      const p = await prisma.product.findUniqueOrThrow({ where: { slug: 'canvas-market-tote' } });
      expect(p.basePrice.toFixed(2)).toBe('139.00'); // dry run wrote nothing
    });

    it('manages the category tree without cycles and refuses to delete categories in use', async () => {
      const parent = await http('post', '/admin/categories', 'product-manager').send({ name: `Swimwear ${run}` });
      expect(parent.status).toBe(201);
      const child = await http('post', '/admin/categories', 'product-manager').send({ name: 'Bikinis', parentId: parent.body.data.id });
      expect(child.body.data.slug).toMatch(/^swimwear-.*-bikinis$/);
      const cycle = await http('patch', `/admin/categories/${parent.body.data.id}`, 'product-manager').send({ name: `Swimwear ${run}`, parentId: child.body.data.id });
      expect(cycle.status).toBe(400);
      await http('delete', `/admin/categories/${parent.body.data.id}`, 'product-manager').expect(409); // has a child
      const dresses = await prisma.category.findUniqueOrThrow({ where: { slug: 'womens-fashion-dresses' } });
      await http('delete', `/admin/categories/${dresses.id}`, 'product-manager').expect(409); // has products
      await http('delete', `/admin/categories/${child.body.data.id}`, 'product-manager').expect(200);
      const tree = (await http('get', '/categories')).body.data.map((c: { slug: string }) => c.slug);
      expect(tree).toContain(parent.body.data.slug); // storefront cache was invalidated
    });

    it('accepts real images and rejects disguised files', async () => {
      const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
      const ok = await http('post', '/admin/uploads/images', 'product-manager').attach('files', png, 'a.png');
      expect(ok.status).toBe(201);
      expect(ok.body.data[0].url).toMatch(/\/uploads\/products\/\d{4}-\d{2}\/[a-f0-9]{32}\.png$/);
      const fake = await http('post', '/admin/uploads/images', 'product-manager').attach('files', Buffer.from('<script>alert(1)</script>'), 'evil.png');
      expect(fake.status).toBe(400);
    });
  });

  describe('fulfilment', () => {
    it('ship turns the reservation into a sale; deliver collects payment, sales and earnings', async () => {
      const v = await stockedVariant('woven-leather-slides', 10);
      const sold = (await prisma.product.findUniqueOrThrow({ where: { id: v.productId } })).soldCount;
      const number = await placeOrder(v.id, 2);
      expect(await reserved(v.id)).toBe(2);

      await http('post', `/admin/orders/${number}/deliver`, 'order-manager').expect(409); // not shipped yet
      const shipped = await http('post', `/admin/orders/${number}/ship`, 'order-manager').send({ carrier: 'VÉLORA Dispatch', riderName: 'Kwabena', riderPhone: '+233241112233' });
      expect(shipped.status).toBe(200);
      expect(shipped.body.data).toMatchObject({ status: 'SHIPPED', can: { ship: false, deliver: true, cancel: false } });
      expect(await onHand(v.id)).toBe(8);
      expect(await reserved(v.id)).toBe(0);
      await http('post', `/admin/orders/${number}/cancel`, 'order-manager').send({ reason: 'Too late' }).expect(409);

      const shipmentId = shipped.body.data.shipmentsFull[0].id;
      await http('post', `/admin/shipments/${shipmentId}/events`, 'warehouse-officer').send({ status: 'OUT_FOR_DELIVERY', description: 'With rider', location: 'Osu' }).expect(200);

      const delivered = await http('post', `/admin/orders/${number}/deliver`, 'order-manager');
      expect(delivered.body.data).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID' });
      expect(delivered.body.data.payments[0].status).toBe('SUCCESS');
      expect((await prisma.product.findUniqueOrThrow({ where: { id: v.productId } })).soldCount).toBe(sold + 2);
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: number }, include: { items: { include: { commission: true } } } });
      expect(order.items[0].commission?.status).toBe('ELIGIBLE'); // vendor product
      expect(await prisma.stockMovement.count({ where: { referenceType: 'order', referenceId: order.id, type: 'SALE' } })).toBe(1);
    });

    it('staff cancellation releases stock and is recorded with a reason', async () => {
      const v = await stockedVariant('satin-headwrap', 5);
      const number = await placeOrder(v.id, 1);
      await http('post', `/admin/orders/${number}/cancel`, 'order-manager').send({}).expect(422);
      const res = await http('post', `/admin/orders/${number}/cancel`, 'order-manager').send({ reason: 'Customer asked by phone' });
      expect(res.body.data.status).toBe('CANCELLED');
      expect(await reserved(v.id)).toBe(0);
      expect(res.body.data.historyFull.at(-1)).toMatchObject({ status: 'CANCELLED', by: 'Akosua Darko' });
    });

    it('searches orders by number, email or SKU', async () => {
      const v = await stockedVariant('canvas-market-tote');
      const number = await placeOrder(v.id);
      const res = await http('get', `/admin/orders?q=${number}`, 'customer-support');
      expect(res.body.data.map((o: { orderNumber: string }) => o.orderNumber)).toEqual([number]);
      const open = await http('get', '/admin/orders?view=open&pageSize=100', 'order-manager');
      expect(open.body.data.every((o: { status: string }) => !['DELIVERED', 'CANCELLED'].includes(o.status))).toBe(true);
    });
  });

  describe('inventory', () => {
    it('adjusts stock with a reason, never below reservations, and logs every movement', async () => {
      const v = await stockedVariant('mudcloth-throw-cushion', 3);
      const wh = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
      await placeOrder(v.id, 2);
      const below = await http('post', '/admin/inventory/adjust', 'warehouse-officer').send({ variantId: v.id, warehouseId: wh.id, delta: -2, type: 'DAMAGE', note: 'Water damage' });
      expect(below.status).toBe(409);
      expect(below.body.error.code).toBe('BELOW_RESERVED');
      const ok = await http('post', '/admin/inventory/adjust', 'warehouse-officer').send({ variantId: v.id, warehouseId: wh.id, delta: 12, type: 'ADJUSTMENT', note: 'Stock count' });
      expect(ok.status).toBe(201);
      expect(ok.body.data).toMatchObject({ onHand: 15, reserved: 2 });
      const mv = await http('get', `/admin/stock-movements?variantId=${v.id}&type=ADJUSTMENT`, 'inventory-manager');
      expect(mv.body.data[0]).toMatchObject({ quantity: 12, balanceAfter: 15, note: 'Stock count', by: 'Kojo Addo' });
      const list = await http('get', `/admin/inventory?q=${v.sku}`, 'inventory-manager');
      expect(list.body.data.items[0]).toMatchObject({ sku: v.sku, onHand: 15, reserved: 2, available: 13 });
    });

    it('transfers stock between warehouses in two steps', async () => {
      const v = await stockedVariant('velvet-matte-lipstick', 10);
      const [acc, ksi] = await prisma.warehouse.findMany({ orderBy: { id: 'asc' }, take: 2 });
      const t = await http('post', '/admin/stock-transfers', 'inventory-manager').send({ fromWarehouseId: acc.id, toWarehouseId: ksi.id, items: [{ variantId: v.id, quantity: 4 }] });
      expect(t.status).toBe(201);
      await http('post', `/admin/stock-transfers/${t.body.data.id}/receive`, 'inventory-manager').expect(409); // not dispatched yet
      await http('post', `/admin/stock-transfers/${t.body.data.id}/dispatch`, 'inventory-manager').expect(200);
      const at = async (w: number) => (await prisma.inventory.findFirstOrThrow({ where: { variantId: v.id, warehouseId: w } })).quantityOnHand;
      expect([await at(acc.id), await at(ksi.id)]).toEqual([6, 0]); // in transit
      await http('post', `/admin/stock-transfers/${t.body.data.id}/receive`, 'inventory-manager').expect(200);
      expect([await at(acc.id), await at(ksi.id)]).toEqual([6, 4]);
      const tooMany = await http('post', '/admin/stock-transfers', 'inventory-manager').send({ fromWarehouseId: acc.id, toWarehouseId: ksi.id, items: [{ variantId: v.id, quantity: 99 }] });
      await http('post', `/admin/stock-transfers/${tooMany.body.data.id}/dispatch`, 'inventory-manager').expect(409);
    });

    it('receives a purchase order in parts and updates weighted-average cost', async () => {
      const v = await stockedVariant('relaxed-linen-shirt', 10);
      const wh = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true } });
      await prisma.inventory.updateMany({ where: { variantId: v.id, warehouseId: wh.id }, data: { averageCost: 80 } });
      const supplier = await prisma.supplier.findFirstOrThrow();
      const po = await http('post', '/admin/purchase-orders', 'inventory-manager').send({ supplierId: supplier.id, warehouseId: wh.id, items: [{ variantId: v.id, quantity: 20, unitCost: '110.00' }] });
      expect(po.status).toBe(201);
      expect(po.body.data).toMatchObject({ status: 'DRAFT', totalCost: '2200.00' });
      const line = po.body.data.items[0].id;
      await http('post', `/admin/purchase-orders/${po.body.data.id}/receive`, 'warehouse-officer').send({ items: [{ purchaseOrderItemId: line, quantityReceived: 5 }] }).expect(409);
      await http('post', `/admin/purchase-orders/${po.body.data.id}/order`, 'inventory-manager').expect(200);
      const part = await http('post', `/admin/purchase-orders/${po.body.data.id}/receive`, 'warehouse-officer').send({ items: [{ purchaseOrderItemId: line, quantityReceived: 10, quantityRejected: 1 }] });
      expect(part.body.data.status).toBe('PARTIALLY_RECEIVED');
      const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: v.id, warehouseId: wh.id } });
      expect(inv.quantityOnHand).toBe(20);
      expect(inv.averageCost.toFixed(2)).toBe('95.00'); // (10×80 + 10×110) / 20
      await http('post', `/admin/purchase-orders/${po.body.data.id}/receive`, 'warehouse-officer').send({ items: [{ purchaseOrderItemId: line, quantityReceived: 11 }] }).expect(400);
      const done = await http('post', `/admin/purchase-orders/${po.body.data.id}/receive`, 'warehouse-officer').send({ items: [{ purchaseOrderItemId: line, quantityReceived: 10 }] });
      expect(done.body.data.status).toBe('RECEIVED');
      await http('post', `/admin/purchase-orders/${po.body.data.id}/cancel`, 'inventory-manager').expect(409);
      const val = await http('get', '/admin/inventory/valuation', 'inventory-manager');
      expect(Number(val.body.data.totals.costValue)).toBeGreaterThan(0);
    });
  });

  describe('customers', () => {
    it('lists customers with segments and lets only authorised staff suspend them', async () => {
      const res = await http('get', '/admin/customers?sort=ltv', 'customer-support');
      expect(res.status).toBe(200);
      expect(res.body.data.items[0]).toEqual(expect.objectContaining({ segment: expect.any(String), lifetimeValue: expect.any(String) }));
      expect(Object.keys(res.body.data.segments)).toEqual(['VIP', 'LOYAL', 'NEW', 'AT_RISK', 'PROSPECT', 'REGULAR']);
      const vip = await http('get', '/admin/customers?segment=VIP', 'customer-support');
      expect(vip.body.data.items.every((c: { segment: string }) => c.segment === 'VIP')).toBe(true);

      const me = (await http('get', '/auth/me', 'customer')).body.data;
      const detail = await http('get', `/admin/customers/${me.id}`, 'customer-support');
      expect(detail.body.data).toMatchObject({ email: me.email, segment: 'NEW' });
      await http('patch', `/admin/customers/${me.id}/status`, 'admin').send({ status: 'SUSPENDED', reason: 'Fraud check' }).expect(200);
      await http('get', '/auth/me', 'customer').expect(401);
    });
  });
});
