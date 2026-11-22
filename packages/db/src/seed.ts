import { ulid } from 'ulid';
import { prisma } from './client.js';
import { SEED_IDS as IDS } from './seed-ids.js';
import {
  CouponScope,
  Currency,
  DiscountType,
  Locale,
  Role,
  VendorStatus,
  ProductStatus,
} from '@prisma/client';

// Demo catalog. Each product and variant has a fixed id and is upserted on its own, so adding a
// variant here also reaches a DB seeded by an older version of this file.
const PRODUCTS = [
  {
    id: IDS.productA1,
    vendorId: IDS.vendorA,
    categoryId: IDS.catApparel,
    price: 199_000n,
    vi: { name: 'Áo thun cơ bản', slug: 'ao-thun-co-ban', description: 'Áo thun cotton' },
    en: { name: 'Basic Tee', slug: 'basic-tee', description: 'Cotton t-shirt' },
    variants: [
      {
        id: IDS.variantA1,
        sku: 'TEE-BLK-M',
        attributes: { size: 'M', color: 'black' },
        stock: 100,
      },
    ],
  },
  {
    id: IDS.productA2,
    vendorId: IDS.vendorA,
    categoryId: IDS.catApparel,
    price: 459_000n,
    vi: { name: 'Quần jean ống đứng', slug: 'quan-jean-ong-dung', description: 'Quần jean denim' },
    en: { name: 'Straight Jeans', slug: 'straight-jeans', description: 'Denim jeans' },
    variants: [
      { id: IDS.variantA2W30, sku: 'JEAN-BLU-30', attributes: { waist: '30' }, stock: 50 },
      { id: IDS.variantA2W32, sku: 'JEAN-BLU-32', attributes: { waist: '32' }, stock: 40 },
    ],
  },
  {
    id: IDS.productB1,
    vendorId: IDS.vendorB,
    categoryId: IDS.catHome,
    price: 89_000n,
    vi: { name: 'Cốc sứ trắng', slug: 'coc-su-trang', description: 'Cốc sứ 350ml' },
    en: { name: 'White Ceramic Mug', slug: 'white-ceramic-mug', description: '350ml ceramic mug' },
    variants: [
      { id: IDS.variantB1, sku: 'MUG-WHT-350', attributes: { color: 'white' }, stock: 200 },
    ],
  },
  {
    id: IDS.productB2,
    vendorId: IDS.vendorB,
    categoryId: IDS.catHome,
    price: 149_000n,
    vi: { name: 'Nến thơm', slug: 'nen-thom', description: 'Nến sáp đậu nành' },
    en: { name: 'Scented Candle', slug: 'scented-candle', description: 'Soy wax candle' },
    variants: [
      { id: IDS.variantB2, sku: 'CANDLE-LAV', attributes: { scent: 'lavender' }, stock: 80 },
    ],
  },
] as const;

const SHIPPING_METHODS = [
  {
    id: IDS.shippingAStandard,
    vendorId: IDS.vendorA,
    name: 'Standard',
    price: 30_000n,
    estDays: 3,
  },
  { id: IDS.shippingAExpress, vendorId: IDS.vendorA, name: 'Express', price: 50_000n, estDays: 1 },
  {
    id: IDS.shippingBStandard,
    vendorId: IDS.vendorB,
    name: 'Standard',
    price: 25_000n,
    estDays: 4,
  },
] as const;

// Fixed window so re-runs and tests are deterministic.
const COUPON_STARTS_AT = new Date('2026-01-01T00:00:00.000Z');
const COUPON_ENDS_AT = new Date('2030-12-31T23:59:59.000Z');

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
      paymentTimeoutMinutes: 30,
      supportedCurrencies: [Currency.VND, Currency.USD],
      defaultCurrency: Currency.VND,
    },
  });

  // Demo customer + demo platform admin.
  for (const u of [
    { id: IDS.demoUser, email: 'customer@example.com', name: 'Demo Customer', role: Role.CUSTOMER },
    {
      id: IDS.adminUser,
      email: 'admin@example.com',
      name: 'Demo Admin',
      role: Role.PLATFORM_ADMIN,
    },
  ]) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        primaryLocale: Locale.VI,
        roles: { create: { id: ulid(), role: u.role } },
      },
    });
  }

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

  for (const s of SHIPPING_METHODS) {
    await prisma.shippingMethod.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        vendorId: s.vendorId,
        name: s.name,
        priceAmount: s.price,
        priceCurrency: Currency.VND,
        estDays: s.estDays,
        isActive: true,
      },
    });
  }

  // Category tree with vi + en translations.
  await prisma.category.upsert({
    where: { id: IDS.catRoot },
    update: {},
    create: { id: IDS.catRoot, sortOrder: 0 },
  });
  for (const c of [
    {
      id: IDS.catApparel,
      sortOrder: 1,
      vi: ['Thời trang', 'thoi-trang'],
      en: ['Apparel', 'apparel'],
    },
    {
      id: IDS.catHome,
      sortOrder: 2,
      vi: ['Nhà cửa', 'nha-cua'],
      en: ['Home & Living', 'home-living'],
    },
  ] as const) {
    await prisma.category.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        parentId: IDS.catRoot,
        sortOrder: c.sortOrder,
        translations: {
          create: [
            { id: ulid(), locale: Locale.VI, name: c.vi[0], slug: c.vi[1] },
            { id: ulid(), locale: Locale.EN, name: c.en[0], slug: c.en[1] },
          ],
        },
      },
    });
  }

  // ACTIVE products, each in one category, with vi + en translations and stocked variants.
  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        vendorId: p.vendorId,
        status: ProductStatus.ACTIVE,
        basePriceAmount: p.price,
        basePriceCurrency: Currency.VND,
        translations: {
          create: [
            { id: ulid(), locale: Locale.VI, ...p.vi },
            { id: ulid(), locale: Locale.EN, ...p.en },
          ],
        },
        categories: { create: { categoryId: p.categoryId } },
      },
    });
    for (const v of p.variants) {
      await prisma.productVariant.upsert({
        where: { id: v.id },
        update: {},
        create: {
          id: v.id,
          productId: p.id,
          sku: v.sku,
          attributes: v.attributes,
          priceAmount: p.price,
          priceCurrency: Currency.VND,
          stockOnHand: v.stock,
          stockReserved: 0,
        },
      });
    }
  }

  // One PLATFORM and one VENDOR coupon. PERCENT discountValue is basis points (1000 = 10%).
  await prisma.coupon.upsert({
    where: { id: IDS.couponPlatform },
    update: {},
    create: {
      id: IDS.couponPlatform,
      scope: CouponScope.PLATFORM,
      code: 'WELCOME10',
      discountType: DiscountType.PERCENT,
      discountValue: 1000n,
      minSpendAmount: 100_000n,
      currency: Currency.VND,
      perUserLimit: 1,
      startsAt: COUPON_STARTS_AT,
      endsAt: COUPON_ENDS_AT,
    },
  });
  await prisma.coupon.upsert({
    where: { id: IDS.couponVendorA },
    update: {},
    create: {
      id: IDS.couponVendorA,
      scope: CouponScope.VENDOR,
      vendorId: IDS.vendorA,
      code: 'VENDORA5',
      discountType: DiscountType.PERCENT,
      discountValue: 500n,
      startsAt: COUPON_STARTS_AT,
      endsAt: COUPON_ENDS_AT,
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
