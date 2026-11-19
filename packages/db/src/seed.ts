import { ulid } from 'ulid';
import { prisma } from './client.js';
import { SEED_IDS as IDS } from './seed-ids.js';
import { Currency, Locale, Role, VendorStatus, ProductStatus } from '@prisma/client';

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

  console.info('Seed complete.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
