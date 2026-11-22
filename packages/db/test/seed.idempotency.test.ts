import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { UlidSchema } from '@repo/core';
import { prisma } from '../src/client.js';
import { toMoney } from '../src/money.js';
import { SEED_IDS } from '../src/seed-ids.js';

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

  it('creates exactly three product variants', async () => {
    const count = await prisma.productVariant.count();
    expect(count).toBe(3);
  });

  it('does not duplicate any other seeded row on re-run', async () => {
    expect(await prisma.user.count()).toBe(3); // demo customer + 2 vendor owners
    expect(await prisma.userRole.count()).toBe(3); // CUSTOMER + 2 × VENDOR_OWNER
    expect(await prisma.wallet.count()).toBe(2);
    expect(await prisma.category.count()).toBe(2);
    expect(await prisma.categoryTranslation.count()).toBe(2);
    expect(await prisma.product.count()).toBe(3);
    expect(await prisma.productTranslation.count()).toBe(6);
    expect(await prisma.productCategory.count()).toBe(3);
    expect(await prisma.liveSession.count()).toBe(2);
    expect(await prisma.liveSessionProduct.count()).toBe(5);
  });

  it('gives every seeded row a canonical ULID id (parses through @repo/core id schemas)', async () => {
    const select = { select: { id: true } } as const;
    const rows = [
      ...(await prisma.platformSettings.findMany(select)),
      ...(await prisma.user.findMany(select)),
      ...(await prisma.userRole.findMany(select)),
      ...(await prisma.vendor.findMany(select)),
      ...(await prisma.wallet.findMany(select)),
      ...(await prisma.category.findMany(select)),
      ...(await prisma.categoryTranslation.findMany(select)),
      ...(await prisma.product.findMany(select)),
      ...(await prisma.productTranslation.findMany(select)),
      ...(await prisma.productVariant.findMany(select)),
      ...(await prisma.liveSession.findMany(select)),
    ];
    expect(rows.length).toBeGreaterThan(0);
    const invalid = rows.filter((r) => !UlidSchema.safeParse(r.id).success).map((r) => r.id);
    expect(invalid).toEqual([]);
  });

  it('stores money above the int4 range in BIGINT columns (rolled back)', async () => {
    const huge = 5_000_000_000n; // > 2,147,483,647
    const rollback = new Error('rollback');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.wallet.update({ where: { id: SEED_IDS.walletA }, data: { balanceAmount: huge } });
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: SEED_IDS.walletA } });
        expect(wallet.balanceAmount).toBe(huge);
        expect(toMoney(wallet.balanceAmount, wallet.balanceCurrency).amount).toBe(5_000_000_000);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    const after = await prisma.wallet.findUniqueOrThrow({ where: { id: SEED_IDS.walletA } });
    expect(after.balanceAmount).toBe(0n);
  });
});
