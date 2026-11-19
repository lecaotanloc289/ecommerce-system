import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Apply migrations to the target DB before the suite runs.
export default function setup() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set before running @repo/db tests');
  }
  execSync('npx prisma migrate deploy', { stdio: 'inherit', cwd: pkgDir });
}
