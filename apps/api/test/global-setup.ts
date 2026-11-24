import { execSync } from 'node:child_process';
import { join } from 'node:path';

/** Brings the test database up to the latest migration and seeds reference data (idempotent). */
export default function globalSetup() {
  require('./test-env');
  const cwd = join(__dirname, '..');
  const env = { ...process.env };
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'pipe' });
  execSync('npx ts-node --transpile-only prisma/seed.ts', { cwd, env, stdio: 'pipe' });
}
