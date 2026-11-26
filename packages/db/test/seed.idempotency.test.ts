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
  }, 60_000);

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

  it('creates exactly five product variants', async () => {
    const count = await prisma.productVariant.count();
    expect(count).toBe(5);
  });

  it('does not duplicate any other seeded row on re-run', async () => {
    expect(await prisma.user.count()).toBe(9); // customer + admin + 2 vendor owners + 5 CRM demo customers
    expect(await prisma.userRole.count()).toBe(9); // CUSTOMER + PLATFORM_ADMIN + 2 × VENDOR_OWNER + 5 CRM customers
    expect(await prisma.wallet.count()).toBe(2);
    expect(await prisma.shippingMethod.count()).toBe(3);
    expect(await prisma.category.count()).toBe(3);
    expect(await prisma.categoryTranslation.count()).toBe(4);
    expect(await prisma.product.count()).toBe(4);
    expect(await prisma.productTranslation.count()).toBe(8);
    expect(await prisma.productCategory.count()).toBe(4);
    expect(await prisma.coupon.count()).toBe(2);
    expect(await prisma.order.count()).toBe(9);
    expect(await prisma.subOrder.count()).toBe(9);
    expect(await prisma.orderItem.count()).toBe(9);
    expect(await prisma.vendorCustomer.count()).toBe(5);
    expect(await prisma.vendorCustomerNote.count()).toBe(1);
    expect(await prisma.customerVendorPreference.count()).toBe(1);
    expect(await prisma.crmAutomation.count()).toBe(1);
    expect(await prisma.crmConsentEvent.count()).toBe(1);
    expect(await prisma.liveSession.count()).toBe(2);
    expect(await prisma.liveSessionProduct.count()).toBe(4);
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
      ...(await prisma.shippingMethod.findMany(select)),
      ...(await prisma.coupon.findMany(select)),
      ...(await prisma.liveSession.findMany(select)),
    ];
    expect(rows.length).toBeGreaterThan(0);
    const invalid = rows.filter((r) => !UlidSchema.safeParse(r.id).success).map((r) => r.id);
    expect(invalid).toEqual([]);
  });

  it('seeds demo data that later waves rely on', async () => {
    const vendors = await prisma.vendor.findMany({
      where: { status: 'ACTIVE' },
      include: { wallet: true, shippingMethods: { where: { isActive: true } } },
    });
    expect(vendors).toHaveLength(2);
    for (const v of vendors) {
      expect(v.wallet).not.toBeNull();
      expect(v.shippingMethods.length).toBeGreaterThanOrEqual(1);
    }

    const products = await prisma.product.findMany({
      where: { status: 'ACTIVE' },
      include: { translations: true, variants: true, categories: true },
    });
    expect(products.length).toBeGreaterThanOrEqual(3);
    expect(new Set(products.map((p) => p.vendorId)).size).toBe(2);
    for (const p of products) {
      expect(p.translations.map((t) => t.locale).sort()).toEqual(['EN', 'VI']);
      expect(p.categories.length).toBeGreaterThanOrEqual(1);
      expect(p.variants.length).toBeGreaterThanOrEqual(1);
      for (const variant of p.variants) {
        expect(variant.stockOnHand).toBeGreaterThan(0);
        expect(variant.priceCurrency).toBe('VND');
      }
    }

    const coupons = await prisma.coupon.findMany();
    expect(coupons.map((c) => c.scope).sort()).toEqual(['PLATFORM', 'VENDOR']);
    for (const c of coupons) {
      expect(c.discountType).toBe('PERCENT');
      expect(c.discountValue).toBeGreaterThanOrEqual(1n); // basis points, 1..10000
      expect(c.discountValue).toBeLessThanOrEqual(10_000n);
    }

    const admin = await prisma.userRole.findMany({ where: { role: 'PLATFORM_ADMIN' } });
    expect(admin.map((r) => r.userId)).toEqual([SEED_IDS.adminUser]);

    const emails = (await prisma.user.findMany({ select: { email: true } })).map((u) => u.email);
    for (const email of emails) expect(email).toBe(email?.toLowerCase());
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
