import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Load this package's .env so `pnpm test` is self-sufficient locally.
// Does not override anything already set in the environment (CI supplies its own).
const pkgDir = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(resolve(pkgDir, '.env'), 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // No .env (e.g. CI) — rely on the environment; test/setup.ts guards DATABASE_URL.
}

export default defineConfig({
  test: {
    globalSetup: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    // Propagate the DB URLs into the forked test workers.
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      SHADOW_DATABASE_URL: process.env.SHADOW_DATABASE_URL ?? '',
    },
  },
});
