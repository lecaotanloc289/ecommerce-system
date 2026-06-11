import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { prisma } from '../src/client.js';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('seed idempotency', () => {
  beforeAll(() => {
    execSync('pnpm seed', { stdio: 'inherit', cwd: pkgDir });
    execSync('pnpm seed', { stdio: 'inherit', cwd: pkgDir }); // second run must not duplicate
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates exactly one platform settings row', async () => {
    const count = await prisma.platformSettings.count();
    expect(count).toBe(1);
  });

  it('creates exactly two vendors', async () => {
    const count = await prisma.vendor.count();
    expect(count).toBe(2);
  });

  it('creates exactly one product variant', async () => {
    const count = await prisma.productVariant.count();
    expect(count).toBe(1);
  });
});
