/**
 * E2E tests run against a separate database so they never touch development data.
 * Override with TEST_DATABASE_URL. Secrets here are test-only values.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'mysql://root:@localhost:3306/velora_test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET ??= 'test-only-secret-test-only-secret-test-only-secret';
process.env.SEED_SUPER_ADMIN_EMAIL = 'admin@velora.test';
process.env.SEED_SUPER_ADMIN_PASSWORD = 'Test-Super-Admin-123';
process.env.SEED_DEMO_PASSWORD = 'Test-Demo-Password-123';
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.LOGIN_MAX_FAILED_ATTEMPTS = '5';
process.env.PAYMENT_SIMULATOR = 'true';
// Test-only Paystack secret: lets the e2e suite sign webhooks exactly as Paystack does. No network calls are made with it.
process.env.PAYSTACK_SECRET_KEY = 'sk_test_e2e_only_not_a_real_key';
process.env.HUBTEL_CLIENT_ID = '';
process.env.HUBTEL_CLIENT_SECRET = '';
process.env.HUBTEL_MERCHANT_ACCOUNT = '';
