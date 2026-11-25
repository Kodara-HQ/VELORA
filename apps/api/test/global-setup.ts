import { execSync } from 'node:child_process';
import { join } from 'node:path';

/** Brings the test database up to the latest migration and seeds reference data (idempotent). */
export default function globalSetup() {
  require('./test-env');
  const cwd = join(__dirname, '..');
  const env = { ...process.env };
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'pipe' });
  execSync('npx ts-node --transpile-only prisma/seed.ts', { cwd, env, stdio: 'pipe' });
  // Prices in the tests are list prices: remove any demo sales an earlier seed created.
  execSync('npx prisma db execute --stdin --schema prisma/schema.prisma', { cwd, env, stdio: 'pipe', input: "DELETE FROM promotions WHERE slug IN ('weekend-flash-sale', 'kente-week');" });
}
