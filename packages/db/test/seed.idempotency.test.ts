import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { prisma } from '../src/client.js';

describe('seed idempotency', () => {
  beforeAll(() => {
    execSync('pnpm seed', { stdio: 'inherit' });
    execSync('pnpm seed', { stdio: 'inherit' }); // second run must not duplicate
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
