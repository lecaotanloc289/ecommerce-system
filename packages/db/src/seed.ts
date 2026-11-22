import { ulid } from 'ulid';
import { prisma } from './client.js';
import { SEED_IDS as IDS } from './seed-ids.js';
import {
  Currency,
  Locale,
  Role,
  VendorStatus,
  ProductStatus,
  LiveSessionStatus,
  LiveEndReason,
} from '@prisma/client';

async function main() {
  // Platform settings singleton.
  await prisma.platformSettings.upsert({
    where: { id: IDS.settings },
    update: {},
    create: {
      id: IDS.settings,
      commissionBps: 1000,
      holdPeriodDays: 7,
      refundWindowDays: 7,
      maxCouponStack: 1,
      supportedCurrencies: [Currency.VND, Currency.USD],
      defaultCurrency: Currency.VND,
      liveDisconnectGraceSeconds: 120,
      liveChatCooldownSeconds: 2,
    },
  });

  // Demo customer.
  await prisma.user.upsert({
    where: { id: IDS.demoUser },
    update: {},
    create: {
      id: IDS.demoUser,
      email: 'customer@example.com',
      name: 'Demo Customer',
      primaryLocale: Locale.VI,
      roles: { create: { id: ulid(), role: Role.CUSTOMER } },
    },
  });

  // Two vendor owners + vendors + wallets + VENDOR_OWNER role.
  for (const v of [
    {
      owner: IDS.vendorAOwner,
      vendor: IDS.vendorA,
      wallet: IDS.walletA,
      slug: 'vendor-a',
      name: 'Vendor A',
    },
    {
      owner: IDS.vendorBOwner,
      vendor: IDS.vendorB,
      wallet: IDS.walletB,
      slug: 'vendor-b',
      name: 'Vendor B',
    },
  ]) {
    await prisma.user.upsert({
      where: { id: v.owner },
      update: {},
      create: {
        id: v.owner,
        email: `${v.slug}@example.com`,
        name: `${v.name} Owner`,
        primaryLocale: Locale.VI,
      },
    });
    await prisma.vendor.upsert({
      where: { id: v.vendor },
      update: {},
      create: {
        id: v.vendor,
        ownerId: v.owner,
        slug: v.slug,
        displayName: v.name,
        status: VendorStatus.ACTIVE,
      },
    });
    await prisma.userRole.upsert({
      where: {
        userId_role_vendorId: { userId: v.owner, role: Role.VENDOR_OWNER, vendorId: v.vendor },
      },
      update: {},
      create: { id: ulid(), userId: v.owner, role: Role.VENDOR_OWNER, vendorId: v.vendor },
    });
    await prisma.wallet.upsert({
      where: { id: v.wallet },
      update: {},
      create: {
        id: v.wallet,
        vendorId: v.vendor,
        balanceAmount: 0n,
        balanceCurrency: Currency.VND,
      },
    });
  }

  // Category tree with vi + en translations.
  await prisma.category.upsert({
    where: { id: IDS.catRoot },
    update: {},
    create: { id: IDS.catRoot, sortOrder: 0 },
  });
  await prisma.category.upsert({
    where: { id: IDS.catApparel },
    update: {},
    create: {
      id: IDS.catApparel,
      parentId: IDS.catRoot,
      sortOrder: 1,
      translations: {
        create: [
          { id: ulid(), locale: Locale.VI, name: 'Thời trang', slug: 'thoi-trang' },
          { id: ulid(), locale: Locale.EN, name: 'Apparel', slug: 'apparel' },
        ],
      },
    },
  });

  // One product on Vendor A, in Apparel, with one variant.
  await prisma.product.upsert({
    where: { id: IDS.productA1 },
    update: {},
    create: {
      id: IDS.productA1,
      vendorId: IDS.vendorA,
      status: ProductStatus.ACTIVE,
      basePriceAmount: 199_000n,
      basePriceCurrency: Currency.VND,
      translations: {
        create: [
          {
            id: ulid(),
            locale: Locale.VI,
            name: 'Áo thun cơ bản',
            slug: 'ao-thun-co-ban',
            description: 'Áo thun cotton',
          },
          {
            id: ulid(),
            locale: Locale.EN,
            name: 'Basic Tee',
            slug: 'basic-tee',
            description: 'Cotton t-shirt',
          },
        ],
      },
      categories: { create: { categoryId: IDS.catApparel } },
      variants: {
        create: {
          id: IDS.variantA1,
          sku: 'TEE-BLK-M',
          attributes: { size: 'M', color: 'black' },
          priceAmount: 199_000n,
          priceCurrency: Currency.VND,
          stockOnHand: 100,
          stockReserved: 0,
        },
      },
    },
  });

  // Two more ACTIVE products on Vendor A (live sessions pin 2-3 products).
  for (const p of [
    {
      id: IDS.productA2,
      variant: IDS.variantA2,
      sku: 'HOODIE-GRY-L',
      price: 399_000n,
      vi: ['Áo hoodie', 'ao-hoodie'],
      en: ['Hoodie', 'hoodie'],
    },
    {
      id: IDS.productA3,
      variant: IDS.variantA3,
      sku: 'CAP-BLK-OS',
      price: 99_000n,
      vi: ['Mũ lưỡi trai', 'mu-luoi-trai'],
      en: ['Baseball Cap', 'baseball-cap'],
    },
  ]) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        vendorId: IDS.vendorA,
        status: ProductStatus.ACTIVE,
        basePriceAmount: p.price,
        basePriceCurrency: Currency.VND,
        translations: {
          create: [
            { id: ulid(), locale: Locale.VI, name: p.vi[0]!, slug: p.vi[1]! },
            { id: ulid(), locale: Locale.EN, name: p.en[0]!, slug: p.en[1]! },
          ],
        },
        categories: { create: { categoryId: IDS.catApparel } },
        variants: {
          create: {
            id: p.variant,
            sku: p.sku,
            attributes: { size: 'M' },
            priceAmount: p.price,
            priceCurrency: Currency.VND,
            stockOnHand: 100,
            stockReserved: 0,
          },
        },
      },
    });
  }

  // Live sessions for Vendor A: one ENDED (3 products) and one SCHEDULED (2 products).
  await prisma.liveSession.upsert({
    where: { id: IDS.liveSessionEnded },
    update: {},
    create: {
      id: IDS.liveSessionEnded,
      vendorId: IDS.vendorA,
      createdById: IDS.vendorAOwner,
      idempotencyKey: 'seed-live-ended',
      title: 'Seed replay',
      status: LiveSessionStatus.ENDED,
      startedAt: new Date('2026-11-20T10:00:00Z'),
      endedAt: new Date('2026-11-20T11:00:00Z'),
      endReason: LiveEndReason.VENDOR,
      recordingVideoId: 'seedrecording1',
      peakViewers: 128,
      products: {
        create: [IDS.productA1, IDS.productA2, IDS.productA3].map((productId, position) => ({
          productId,
          position,
        })),
      },
    },
  });
  await prisma.liveSession.upsert({
    where: { id: IDS.liveSessionScheduled },
    update: {},
    create: {
      id: IDS.liveSessionScheduled,
      vendorId: IDS.vendorA,
      createdById: IDS.vendorAOwner,
      idempotencyKey: 'seed-live-scheduled',
      title: 'Seed upcoming live',
      status: LiveSessionStatus.SCHEDULED,
      scheduledAt: new Date('2026-12-01T10:00:00Z'),
      products: {
        create: [IDS.productA1, IDS.productA2].map((productId, position) => ({
          productId,
          position,
        })),
      },
    },
  });

  console.info('Seed complete.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
