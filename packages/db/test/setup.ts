import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Apply migrations, then the idempotent seed, before the suite runs: several test files read
// seeded rows (SEED_IDS) and must not depend on `seed.idempotency.test.ts` having run first.
export default function setup() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set before running @repo/db tests');
  }
  execSync('npx prisma migrate deploy', { stdio: 'inherit', cwd: pkgDir });
  execSync('pnpm seed', { stdio: 'inherit', cwd: pkgDir });
}
