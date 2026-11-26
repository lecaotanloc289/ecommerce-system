import { createHash } from 'node:crypto';
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
  LiveSessionStatus,
  LiveEndReason,
  OrderStatus,
  SubOrderStatus,
  ConsentSource,
  ConsentAction,
  CrmAutomationKind,
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
      liveDisconnectGraceSeconds: 120,
      liveChatCooldownSeconds: 2,
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

  await seedCrmDemo();

  // Live sessions for Vendor A: one ENDED and one SCHEDULED, pinning seeded products.
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
        create: [IDS.productA1, IDS.productA2].map((productId, position) => ({
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

// ---- Vendor CRM demo (vendor A) ----
// Fixed-date valid sub-orders (COMPLETED) so each demo customer lands in one segment of the CRM
// plan (C3) for the reference date CRM_SEED_REFERENCE_DATE with the default thresholds
// (at-risk > 60 days, lapsed > 180 days, VIP >= 3 orders, returning >= 2):
//   crm-new       1 order  last 2026-11-10 (13d)  -> NEW
//   crm-returning 2 orders last 2026-11-01 (22d)  -> RETURNING
//   crm-vip       3 orders last 2026-11-15 (8d)   -> VIP
//   crm-at-risk   1 valid order last 2026-08-01 (114d) -> AT_RISK (+ a newer CANCELLED order that must not count)
//   crm-lapsed    1 order  last 2026-03-01 (267d) -> LAPSED
// Segments drift as real time passes; tests must pass an explicit `now`.
const CRM_CUSTOMERS = [
  {
    id: IDS.crmCustomerNew,
    slug: 'crm-new',
    name: 'CRM Khách mới',
    city: 'Hà Nội',
    tags: [] as string[],
  },
  {
    id: IDS.crmCustomerReturning,
    slug: 'crm-returning',
    name: 'CRM Khách quay lại',
    city: 'Đà Nẵng',
    tags: ['quen'],
  },
  {
    id: IDS.crmCustomerVip,
    slug: 'crm-vip',
    name: 'CRM Khách VIP',
    city: 'TP. Hồ Chí Minh',
    tags: ['vip', 'quen'],
  },
  {
    id: IDS.crmCustomerAtRisk,
    slug: 'crm-at-risk',
    name: 'CRM Khách sắp rời',
    city: 'Hải Phòng',
    tags: [] as string[],
  },
  {
    id: IDS.crmCustomerLapsed,
    slug: 'crm-lapsed',
    name: 'CRM Khách đã rời',
    city: 'Cần Thơ',
    tags: [] as string[],
  },
] as const;

// paid = subtotal + shipping - discount - platformDiscount (roadmap D7). Item = jeans W30 (459 000) or tee (199 000).
const CRM_ORDERS = [
  {
    key: 'New1',
    customer: IDS.crmCustomerNew,
    order: IDS.crmOrderNew1,
    sub: IDS.crmSubOrderNew1,
    item: IDS.crmItemNew1,
    at: '2026-11-10T03:00:00.000Z',
    variant: IDS.variantA1,
    title: 'Áo thun cơ bản',
    unit: 199_000n,
    discount: 0n,
    platformDiscount: 0n,
    cancelled: false,
  },
  {
    key: 'Returning1',
    customer: IDS.crmCustomerReturning,
    order: IDS.crmOrderReturning1,
    sub: IDS.crmSubOrderReturning1,
    item: IDS.crmItemReturning1,
    at: '2026-09-20T03:00:00.000Z',
    variant: IDS.variantA1,
    title: 'Áo thun cơ bản',
    unit: 199_000n,
    discount: 0n,
    platformDiscount: 19_900n,
    cancelled: false,
  },
  {
    key: 'Returning2',
    customer: IDS.crmCustomerReturning,
    order: IDS.crmOrderReturning2,
    sub: IDS.crmSubOrderReturning2,
    item: IDS.crmItemReturning2,
    at: '2026-11-01T03:00:00.000Z',
    variant: IDS.variantA2W30,
    title: 'Quần jean ống đứng',
    unit: 459_000n,
    discount: 0n,
    platformDiscount: 0n,
    cancelled: false,
  },
  {
    key: 'Vip1',
    customer: IDS.crmCustomerVip,
    order: IDS.crmOrderVip1,
    sub: IDS.crmSubOrderVip1,
    item: IDS.crmItemVip1,
    at: '2026-08-15T03:00:00.000Z',
    variant: IDS.variantA2W32,
    title: 'Quần jean ống đứng',
    unit: 459_000n,
    discount: 0n,
    platformDiscount: 0n,
    cancelled: false,
  },
  {
    key: 'Vip2',
    customer: IDS.crmCustomerVip,
    order: IDS.crmOrderVip2,
    sub: IDS.crmSubOrderVip2,
    item: IDS.crmItemVip2,
    at: '2026-10-05T03:00:00.000Z',
    variant: IDS.variantA1,
    title: 'Áo thun cơ bản',
    unit: 199_000n,
    discount: 0n,
    platformDiscount: 0n,
    cancelled: false,
  },
  {
    key: 'Vip3',
    customer: IDS.crmCustomerVip,
    order: IDS.crmOrderVip3,
    sub: IDS.crmSubOrderVip3,
    item: IDS.crmItemVip3,
    at: '2026-11-15T03:00:00.000Z',
    variant: IDS.variantA2W30,
    title: 'Quần jean ống đứng',
    unit: 459_000n,
    discount: 22_950n,
    platformDiscount: 0n,
    cancelled: false,
  },
  {
    key: 'AtRisk1',
    customer: IDS.crmCustomerAtRisk,
    order: IDS.crmOrderAtRisk1,
    sub: IDS.crmSubOrderAtRisk1,
    item: IDS.crmItemAtRisk1,
    at: '2026-08-01T03:00:00.000Z',
    variant: IDS.variantA1,
    title: 'Áo thun cơ bản',
    unit: 199_000n,
    discount: 0n,
    platformDiscount: 0n,
    cancelled: false,
  },
  {
    key: 'AtRiskCancelled',
    customer: IDS.crmCustomerAtRisk,
    order: IDS.crmOrderAtRiskCancelled,
    sub: IDS.crmSubOrderAtRiskCancelled,
    item: IDS.crmItemAtRiskCancelled,
    at: '2026-11-05T03:00:00.000Z',
    variant: IDS.variantA1,
    title: 'Áo thun cơ bản',
    unit: 199_000n,
    discount: 0n,
    platformDiscount: 0n,
    cancelled: true,
  },
  {
    key: 'Lapsed1',
    customer: IDS.crmCustomerLapsed,
    order: IDS.crmOrderLapsed1,
    sub: IDS.crmSubOrderLapsed1,
    item: IDS.crmItemLapsed1,
    at: '2026-03-01T03:00:00.000Z',
    variant: IDS.variantA2W30,
    title: 'Quần jean ống đứng',
    unit: 459_000n,
    discount: 0n,
    platformDiscount: 0n,
    cancelled: false,
  },
] as const;

// The hardcoded numbers below mirror the seeded PlatformSettings (commission 1000 bps = 10%), vendor A's
// "Standard" shipping method (30 000) and coupons VENDORA5 (5%) / WELCOME10 (10%). These demo orders are
// CRM fixtures only: they have NO Payment, ledger, wallet or coupon-redemption rows. Segment tests must
// classify with an explicit now = CRM_SEED_REFERENCE_DATE (seed-ids.ts), never the wall clock.
const CRM_SHIPPING = 30_000n;

async function seedCrmDemo() {
  for (const c of CRM_CUSTOMERS) {
    await prisma.user.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        email: `${c.slug}@example.com`,
        name: c.name,
        primaryLocale: Locale.VI,
        roles: { create: { id: ulid(), role: Role.CUSTOMER } },
      },
    });
    await prisma.vendorCustomer.upsert({
      where: { vendorId_userId: { vendorId: IDS.vendorA, userId: c.id } },
      update: {},
      create: { vendorId: IDS.vendorA, userId: c.id, tags: [...c.tags] },
    });
  }

  for (const o of CRM_ORDERS) {
    const city = CRM_CUSTOMERS.find((c) => c.id === o.customer)?.city ?? '';
    const at = new Date(o.at);
    const paid = o.unit + CRM_SHIPPING - o.discount - o.platformDiscount;
    await prisma.order.upsert({
      where: { id: o.order },
      update: {},
      create: {
        id: o.order,
        customerId: o.customer,
        status: o.cancelled ? OrderStatus.CANCELLED : OrderStatus.COMPLETED,
        currency: Currency.VND,
        itemsTotalAmount: o.unit,
        shippingTotalAmount: CRM_SHIPPING,
        discountTotalAmount: o.discount + o.platformDiscount,
        grandTotalAmount: paid,
        idempotencyKey: `seed-crm-order-${o.key}`,
        createdAt: at,
      },
    });
    await prisma.subOrder.upsert({
      where: { id: o.sub },
      update: {},
      create: {
        id: o.sub,
        orderId: o.order,
        vendorId: IDS.vendorA,
        status: o.cancelled ? SubOrderStatus.CANCELLED : SubOrderStatus.COMPLETED,
        subtotalAmount: o.unit,
        shippingAmount: CRM_SHIPPING,
        discountAmount: o.discount,
        platformDiscountAmount: o.platformDiscount,
        commissionAmount: ((o.unit - o.discount) * 1000n) / 10_000n,
        currency: Currency.VND,
        shippingMethodId: IDS.shippingAStandard,
        shippingAddress: {
          recipientName: CRM_CUSTOMERS.find((c) => c.id === o.customer)?.name ?? '',
          phone: '0900000000',
          line1: '1 Demo Street',
          line2: null,
          ward: 'Demo ward',
          district: 'Demo district',
          city,
          country: 'VN',
        },
        cancelledAt: o.cancelled ? at : null,
        deliveredAt: o.cancelled ? null : at,
        completedAt: o.cancelled ? null : at,
        // Historical demo orders have no Payment / escrow ledger rows, so they count as already
        // settled: without this the `release-payouts` job would credit vendor A's wallet for them.
        payoutReleasedAt: o.cancelled ? null : at,
        createdAt: at,
      },
    });
    await prisma.orderItem.upsert({
      where: { id: o.item },
      update: {},
      create: {
        id: o.item,
        subOrderId: o.sub,
        variantId: o.variant,
        productTitleSnapshot: o.title,
        variantAttributesSnapshot: {},
        unitPriceAmount: o.unit,
        quantity: 1,
        lineTotalAmount: o.unit,
        currency: Currency.VND,
      },
    });
  }

  // crm-vip opted in to marketing from vendor A (hash = sha256 of a throwaway demo token).
  await prisma.customerVendorPreference.upsert({
    where: { userId_vendorId: { userId: IDS.crmCustomerVip, vendorId: IDS.vendorA } },
    update: {},
    create: {
      userId: IDS.crmCustomerVip,
      vendorId: IDS.vendorA,
      marketingOptInAt: new Date('2026-08-16T03:00:00.000Z'),
      marketingOptInSource: ConsentSource.CHECKOUT,
      unsubscribeTokenHash: createHash('sha256')
        .update('seed-crm-vip-unsubscribe-token')
        .digest('hex'),
    },
  });

  // Append-only consent evidence for the opt-in above.
  await prisma.crmConsentEvent.upsert({
    where: { id: IDS.crmConsentEventVip },
    update: {},
    create: {
      id: IDS.crmConsentEventVip,
      userId: IDS.crmCustomerVip,
      vendorId: IDS.vendorA,
      action: ConsentAction.MARKETING_OPT_IN,
      source: ConsentSource.CHECKOUT,
      createdAt: new Date('2026-08-16T03:00:00.000Z'),
    },
  });

  await prisma.vendorCustomerNote.upsert({
    where: { id: IDS.crmNote },
    update: {},
    create: {
      id: IDS.crmNote,
      vendorId: IDS.vendorA,
      userId: IDS.crmCustomerVip,
      authorId: IDS.vendorAOwner,
      body: 'Khách thích size 32, hay mua vào cuối tháng.',
      createdAt: new Date('2026-11-16T03:00:00.000Z'),
    },
  });

  await prisma.crmAutomation.upsert({
    where: { id: IDS.crmAutomationThankYou },
    update: {},
    create: {
      id: IDS.crmAutomationThankYou,
      vendorId: IDS.vendorA,
      kind: CrmAutomationKind.THANK_YOU,
      isEnabled: true,
      delayDays: 1,
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
