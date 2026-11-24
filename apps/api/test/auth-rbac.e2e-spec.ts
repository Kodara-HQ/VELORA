import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { sha256 } from '../src/common/utils/request';

/**
 * Covers Phase 1 acceptance: registration, login, lockout, refresh rotation + reuse detection,
 * password reset, CSRF guard on cookie endpoints, rate limiting, and backend-enforced RBAC.
 */
describe('Auth & RBAC (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const run = Date.now().toString(36);
  let ipSeq = 0;
  // Each logical client gets its own IP so per-IP rate limits don't interfere between tests.
  const freshIp = () => `10.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}.${Math.floor(Math.random() * 250) + 1}`;
  const api = (ip = freshIp()) => ({
    get: (url: string) => request(app.getHttpServer()).get(`/api/v1${url}`).set('X-Forwarded-For', ip),
    post: (url: string) => request(app.getHttpServer()).post(`/api/v1${url}`).set('X-Forwarded-For', ip),
    put: (url: string) => request(app.getHttpServer()).put(`/api/v1${url}`).set('X-Forwarded-For', ip),
    patch: (url: string) => request(app.getHttpServer()).patch(`/api/v1${url}`).set('X-Forwarded-For', ip),
  });
  const PASSWORD = 'Correct-Horse-42';

  const login = async (email: string, password: string) => {
    const res = await api().post('/auth/login').set('X-Velora-Client', 'mobile').send({ email, password });
    expect(res.status).toBe(200);
    return res.body.data.tokens as { accessToken: string; refreshToken: string };
  };
  const register = async (suffix: string) => {
    const email = `e2e.${suffix}.${run}@example.test`;
    const res = await api().post('/auth/register').set('X-Velora-Client', 'mobile')
      .send({ email, password: PASSWORD, firstName: 'Test', lastName: suffix });
    expect(res.status).toBe(201);
    return { email, id: res.body.data.user.id as number, ...res.body.data.tokens as { accessToken: string; refreshToken: string } };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(mod.createNestApplication());
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(() => app?.close());

  describe('platform', () => {
    it('reports health', async () => {
      const res = await api().get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, data: { status: 'ok', database: 'up' } });
    });

    it('serves public settings without auth and never private ones', async () => {
      const res = await api().get('/settings/public');
      expect(res.body.data.store.name).toBe('VÉLORA');
      expect(res.body.data.currency.default).toBe('GHS');
      expect(res.body.data.marketplace).toBeUndefined();
    });

    it('sets security headers', async () => {
      const res = await api().get('/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('registration', () => {
    it('creates a customer with loyalty account, wishlist and no back-office permissions', async () => {
      const u = await register('reg');
      const me = await api().get('/auth/me').set('Authorization', `Bearer ${u.accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.data).toMatchObject({ email: u.email, roles: ['customer'], permissions: [], vendorId: null });
      const db = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { loyaltyAccount: true, wishlists: true, customer: true } });
      expect(db.passwordHash).toMatch(/^\$argon2id\$/);
      expect(db.loyaltyAccount).not.toBeNull();
      expect(db.wishlists).toHaveLength(1);
      expect(db.customer).not.toBeNull();
    });

    it('rejects duplicate emails with 409', async () => {
      const u = await register('dup');
      const res = await api().post('/auth/register').send({ email: u.email.toUpperCase(), password: PASSWORD, firstName: 'A', lastName: 'B' });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/already exists/);
    });

    it('validates input and lists every problem', async () => {
      const res = await api().post('/auth/register').send({ email: 'nope', password: 'short', firstName: '', lastName: 'X', phone: '0241234567', isAdmin: true });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const byField = Object.fromEntries(
        (res.body.error.details as Array<{ field: string; messages: string[] }>).map((d) => [d.field, d.messages.join(' ')]),
      );
      expect(byField.email).toMatch(/valid email/);
      expect(byField.password).toMatch(/Password must be/);
      expect(byField.phone).toMatch(/Ghana mobile number/);
      expect(byField.firstName).toMatch(/required/);
      expect(byField.isAdmin).toMatch(/should not exist/); // mass-assignment blocked
    });

    it('sets an httpOnly SameSite=Strict refresh cookie for web clients and no token in the body', async () => {
      const res = await api().post('/auth/register').set('X-Velora-Client', 'web')
        .send({ email: `e2e.web.${run}@example.test`, password: PASSWORD, firstName: 'Web', lastName: 'User' });
      expect(res.status).toBe(201);
      expect(res.body.data.tokens.refreshToken).toBeUndefined();
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/velora_rt=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    });
  });

  describe('login', () => {
    it('returns the same generic error for unknown email and wrong password', async () => {
      const u = await register('generic');
      const a = await api().post('/auth/login').send({ email: `missing.${run}@example.test`, password: PASSWORD });
      const b = await api().post('/auth/login').send({ email: u.email, password: 'Wrong-Password-1' });
      expect(a.status).toBe(401);
      expect(b.status).toBe(401);
      expect(a.body.error.message).toBe(b.body.error.message);
    });

    it('locks the account after 5 failed attempts, even with the right password', async () => {
      const u = await register('lock');
      for (let i = 0; i < 5; i++) {
        await api().post('/auth/login').send({ email: u.email, password: 'Wrong-Password-1' }).expect(401);
      }
      const res = await api().post('/auth/login').send({ email: u.email, password: PASSWORD });
      expect(res.status).toBe(423);
      expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
      const activity = await prisma.loginActivity.count({ where: { userId: u.id, success: false } });
      expect(activity).toBe(6);
    });

    it('rate-limits repeated requests from one IP', async () => {
      const client = api('203.0.113.7');
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        statuses.push((await client.post('/auth/forgot-password').send({ email: `x${i}@example.test` })).status);
      }
      expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
      expect(statuses).toContain(429);
    });
  });

  describe('sessions', () => {
    it('rejects requests without or with a forged access token', async () => {
      await api().get('/auth/me').expect(401);
      await api().get('/auth/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
    });

    it('rotates refresh tokens and revokes the whole family when an old token is replayed', async () => {
      const u = await register('rotate');
      const r1 = await api().post('/auth/refresh').set('X-Velora-Client', 'mobile').send({ refreshToken: u.refreshToken });
      expect(r1.status).toBe(200);
      const second = r1.body.data.tokens.refreshToken as string;
      expect(second).not.toBe(u.refreshToken);

      // Attacker replays the first (already rotated) token…
      await api().post('/auth/refresh').set('X-Velora-Client', 'mobile').send({ refreshToken: u.refreshToken }).expect(401);
      // …which also kills the legitimate newer token.
      await api().post('/auth/refresh').set('X-Velora-Client', 'mobile').send({ refreshToken: second }).expect(401);
    });

    it('refuses cookie refresh without the client header or from a foreign origin (CSRF)', async () => {
      const reg = await api().post('/auth/register').set('X-Velora-Client', 'web')
        .send({ email: `e2e.csrf.${run}@example.test`, password: PASSWORD, firstName: 'C', lastName: 'S' });
      const cookie = (reg.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
      await api().post('/auth/refresh').set('Cookie', cookie).expect(403);
      await api().post('/auth/refresh').set('Cookie', cookie).set('X-Velora-Client', 'web').set('Origin', 'https://evil.example').expect(403);
      const ok = await api().post('/auth/refresh').set('Cookie', cookie).set('X-Velora-Client', 'web').set('Origin', 'http://localhost:3000');
      expect(ok.status).toBe(200);
      expect(ok.body.data.tokens.accessToken).toBeTruthy();
    });

    it('logout revokes the refresh token', async () => {
      const u = await register('logout');
      await api().post('/auth/logout').set('X-Velora-Client', 'mobile').send({ refreshToken: u.refreshToken }).expect(200);
      await api().post('/auth/refresh').set('X-Velora-Client', 'mobile').send({ refreshToken: u.refreshToken }).expect(401);
    });
  });

  describe('password recovery', () => {
    it('answers identically whether or not the email exists', async () => {
      const a = await api().post('/auth/forgot-password').send({ email: `nobody.${run}@example.test` });
      const u = await register('forgot');
      const b = await api().post('/auth/forgot-password').send({ email: u.email });
      expect(a.status).toBe(200);
      expect(a.body).toEqual(b.body);
      expect(await prisma.passwordResetToken.count({ where: { userId: u.id } })).toBe(1);
    });

    it('resets the password once, signs out other sessions, and rejects reuse', async () => {
      const u = await register('reset');
      const token = `reset-token-${run}-abcdefghijklmnop`;
      await prisma.passwordResetToken.create({ data: { userId: u.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 600_000) } });

      await api().post('/auth/reset-password').send({ token, password: 'Brand-New-Pass-77' }).expect(200);
      await api().post('/auth/reset-password').send({ token, password: 'Another-Pass-88' }).expect(400);
      await api().post('/auth/refresh').set('X-Velora-Client', 'mobile').send({ refreshToken: u.refreshToken }).expect(401);
      await api().post('/auth/login').send({ email: u.email, password: PASSWORD }).expect(401);
      await login(u.email, 'Brand-New-Pass-77');
    });
  });

  describe('role-based access control (enforced on the server)', () => {
    let superToken: string;
    let adminToken: string;
    let productMgrToken: string;
    let financeToken: string;

    let vendorToken: string;
    const DEMO = 'Test-Demo-Password-123';
    const bearer = (t: string) => `Bearer ${t}`;

    beforeAll(async () => {
      superToken = (await login('admin@velora.test', 'Test-Super-Admin-123')).accessToken;
      adminToken = (await login('admin@staff.velora.test', DEMO)).accessToken;
      productMgrToken = (await login('product-manager@staff.velora.test', DEMO)).accessToken;
      financeToken = (await login('finance-officer@staff.velora.test', DEMO)).accessToken;
      vendorToken = (await login('vendor@velora.test', DEMO)).accessToken;
    });

    it('resolves each role to its own permission set', async () => {
      const pm = (await api().get('/auth/me').set('Authorization', bearer(productMgrToken))).body.data;
      expect(pm.permissions).toContain('products.create');
      expect(pm.permissions).not.toContain('finance.view');
      const vendor = (await api().get('/auth/me').set('Authorization', bearer(vendorToken))).body.data;
      expect(vendor.vendorId).toEqual(expect.any(Number));
      expect(vendor.permissions).toEqual(expect.arrayContaining(['vendor_portal.access']));
      expect(vendor.permissions).not.toContain('users.view');
    });

    it('blocks customers, vendors and unrelated staff from user administration', async () => {
      const customer = await register('rbac');
      await api().get('/users').set('Authorization', bearer(customer.accessToken)).expect(403);
      await api().get('/users').set('Authorization', bearer(vendorToken)).expect(403);
      await api().get('/users').set('Authorization', bearer(productMgrToken)).expect(403);
      await api().get('/audit-logs').set('Authorization', bearer(financeToken)).expect(403);
    });

    it('lets authorised staff list users with pagination and filters', async () => {
      const res = await api().get('/users?kind=staff&pageSize=5').set('Authorization', bearer(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 5 });
      expect(res.body.meta.total).toBeGreaterThanOrEqual(9);
      expect(res.body.data[0]).not.toHaveProperty('passwordHash');
    });

    it('only a super admin may change roles, and nobody may grant super admin without being one', async () => {
      const target = await register('promote');
      await api().put(`/users/${target.id}/roles`).set('Authorization', bearer(adminToken)).send({ roles: ['order_manager'] }).expect(403);
      await api().post('/users/staff').set('Authorization', bearer(adminToken))
        .send({ email: `sneaky.${run}@staff.velora.test`, firstName: 'S', lastName: 'A', password: 'Sneaky-Pass-123', roles: ['super_admin'] })
        .expect(403);

      const res = await api().put(`/users/${target.id}/roles`).set('Authorization', bearer(superToken)).send({ roles: ['order_manager'] });
      expect(res.status).toBe(200);
      expect(res.body.data.roles.map((r: { code: string }) => r.code)).toEqual(['order_manager']);
      // New permissions apply to the user's existing access token immediately.
      const me = (await api().get('/auth/me').set('Authorization', bearer(target.accessToken))).body.data;
      expect(me.permissions).toContain('orders.manage');
    });

    it('prevents a super admin from demoting themselves', async () => {
      const me = (await api().get('/auth/me').set('Authorization', bearer(superToken))).body.data;
      const res = await api().put(`/users/${me.id}/roles`).set('Authorization', bearer(superToken)).send({ roles: ['admin'] });
      expect(res.status).toBe(400);
    });

    it('suspending a user cuts off their access token and refresh token immediately', async () => {
      const victim = await register('suspend');
      await api().patch(`/users/${victim.id}/status`).set('Authorization', bearer(adminToken)).send({ status: 'SUSPENDED', reason: 'e2e' }).expect(200);
      await api().get('/auth/me').set('Authorization', bearer(victim.accessToken)).expect(401);
      await api().post('/auth/refresh').set('X-Velora-Client', 'mobile').send({ refreshToken: victim.refreshToken }).expect(401);
      const login = await api().post('/auth/login').send({ email: victim.email, password: PASSWORD });
      expect(login.status).toBe(403);
    });

    it('records privileged actions in the audit log, without secrets', async () => {
      const res = await api().get('/audit-logs?action=users.&pageSize=50').set('Authorization', bearer(superToken));
      expect(res.status).toBe(200);
      const actions = res.body.data.map((l: { action: string }) => l.action);
      expect(actions).toEqual(expect.arrayContaining(['users.roles_changed', 'users.status_changed']));
      expect(JSON.stringify(res.body.data)).not.toMatch(/argon2|Sneaky-Pass/);
    });
  });
});
