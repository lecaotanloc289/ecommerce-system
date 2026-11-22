import { describe, expect, it } from 'vitest';
import {
  CouponInputSchema,
  CouponSchema,
  LedgerEntrySchema,
  MeResponseSchema,
  OrderSchema,
  OrderSummarySchema,
  PaymentSessionSchema,
  PlatformSettingsPublicSchema,
  PlatformSettingsSchema,
  PlatformSettingsUpdateSchema,
  PresignRequestSchema,
  PresignResponseSchema,
  ProductUpsertSchema,
  ProfileUpdateSchema,
  RatingSummarySchema,
  RefundCreateSchema,
  RefundSchema,
  ReviewCreateBodySchema,
  ReviewCreateSchema,
  ReviewPageSchema,
  ReviewSchema,
  ShippingMethodInputSchema,
  ShippingMethodSchema,
  SubOrderSchema,
  SubOrderShipSchema,
  TokenResponseSchema,
  UploadKeySchema,
  VendorApplicationCreateSchema,
  VendorApplicationSchema,
  VendorApproveSchema,
  VendorApplicationListQuerySchema,
  VendorApplicationApprovedEventSchema,
  VendorInvitationAcceptSchema,
  VendorInvitationCreateSchema,
  VendorInvitationCreatedEventSchema,
  VendorStaffMemberSchema,
  VendorInvitationSchema,
  VendorPublicSchema,
  VendorRejectSchema,
  VendorProductStatusSchema,
  WalletSchema,
} from '../src/schemas';
import { ulid } from './fixtures';

const vnd = (amount: number) => ({ amount, currency: 'VND' });
const at = '2026-11-23T10:00:00.000Z';
const later = '2026-12-23T10:00:00.000Z';

describe('me', () => {
  it('parses token and me responses; rejects a wrong token type / bad id', () => {
    expect(
      TokenResponseSchema.safeParse({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 900 })
        .success,
    ).toBe(true);
    expect(
      TokenResponseSchema.safeParse({ accessToken: 'a', tokenType: 'Basic', expiresIn: 900 })
        .success,
    ).toBe(false);
    const me = {
      id: ulid(1),
      email: null,
      name: 'A',
      avatarUrl: null,
      primaryLocale: 'VI',
      roles: ['CUSTOMER'],
      vendorId: null,
    };
    expect(MeResponseSchema.safeParse(me).success).toBe(true);
    expect(MeResponseSchema.safeParse({ ...me, id: 'x' }).success).toBe(false);
  });

  it('profile update needs at least one field', () => {
    expect(ProfileUpdateSchema.safeParse({ name: ' Lan ' }).data).toEqual({ name: 'Lan' });
    expect(ProfileUpdateSchema.safeParse({}).success).toBe(false);
    expect(ProfileUpdateSchema.safeParse({ primaryLocale: 'vi' }).success).toBe(false);
  });
});

describe('upload', () => {
  it('validates presign request/response and keys', () => {
    expect(
      PresignRequestSchema.safeParse({ purpose: 'kyc', contentType: 'image/png', size: 1000 })
        .success,
    ).toBe(true);
    expect(
      PresignRequestSchema.safeParse({ purpose: 'avatar', contentType: 'image/png', size: 1000 })
        .success,
    ).toBe(false);
    expect(
      PresignRequestSchema.safeParse({ purpose: 'kyc', contentType: 'image/png', size: 0 }).success,
    ).toBe(false);
    expect(
      PresignResponseSchema.safeParse({
        url: 'https://s3.local/b/k',
        key: 'kyc/u1/a.png',
        headers: {},
        expiresAt: at,
      }).success,
    ).toBe(true);
    expect(UploadKeySchema.safeParse('kyc/u1/a.png').success).toBe(true);
    expect(UploadKeySchema.safeParse('../etc/passwd').success).toBe(false);
    expect(UploadKeySchema.safeParse('/abs/key').success).toBe(false);
    expect(UploadKeySchema.safeParse('a//b').success).toBe(false);
  });
});

describe('vendor', () => {
  const create = {
    businessLicenseKey: 'kyc/u/license.pdf',
    taxId: '0312345678',
    nationalIdNumber: '079123456789',
    nationalIdKey: 'kyc/u/id.jpg',
    bankName: 'Vietcombank',
    bankAccountNumber: '0123456789',
    accountHolder: 'NGUYEN VAN A',
  };

  it('application create: valid and invalid', () => {
    expect(VendorApplicationCreateSchema.safeParse(create).success).toBe(true);
    expect(
      VendorApplicationCreateSchema.safeParse({ ...create, bankAccountNumber: '12ab' }).success,
    ).toBe(false);
    expect(VendorApplicationCreateSchema.safeParse({ ...create, taxId: '  ' }).success).toBe(false);
  });

  it('application read, public vendor, reject', () => {
    const app = {
      ...create,
      id: ulid(2),
      applicantId: ulid(1),
      status: 'PENDING',
      bankVerified: false,
      reviewedAt: null,
      rejectReason: null,
      createdAt: at,
    };
    expect(VendorApplicationSchema.safeParse(app).success).toBe(true);
    expect(VendorApplicationSchema.safeParse({ ...app, status: 'DONE' }).success).toBe(false);
    const pub = {
      id: ulid(3),
      slug: 'shop-a',
      displayName: 'Shop A',
      logoUrl: null,
      description: null,
    };
    expect(VendorPublicSchema.safeParse(pub).success).toBe(true);
    expect(VendorPublicSchema.safeParse({ ...pub, slug: 'Shop A' }).success).toBe(false);
    expect(VendorRejectSchema.safeParse({ reason: 'Blurry ID' }).success).toBe(true);
    expect(VendorRejectSchema.safeParse({ reason: '' }).success).toBe(false);
  });

  it('approve body, review list query, approved event', () => {
    expect(VendorApproveSchema.safeParse({ slug: 'my-shop', displayName: 'My Shop' }).success).toBe(
      true,
    );
    expect(VendorApproveSchema.safeParse({ slug: 'My Shop', displayName: 'x' }).success).toBe(
      false,
    );
    expect(VendorApproveSchema.safeParse({ slug: '', displayName: 'x' }).success).toBe(false);
    expect(VendorApplicationListQuerySchema.safeParse({ status: 'PENDING' }).success).toBe(true);
    expect(VendorApplicationListQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
    expect(
      VendorApplicationApprovedEventSchema.safeParse({
        applicationId: ulid(1),
        vendorId: ulid(2),
        userId: ulid(3),
      }).success,
    ).toBe(true);
    expect(VendorApplicationApprovedEventSchema.safeParse({ applicationId: ulid(1) }).success).toBe(
      false,
    );
  });
});

describe('order', () => {
  const addr = {
    recipientName: 'A',
    phone: '0901234567',
    line1: '1 Le Loi',
    line2: null,
    ward: 'W',
    district: 'D',
    city: 'HCM',
    country: 'VN',
  };
  const item = {
    id: ulid(10),
    variantId: ulid(11),
    productId: ulid(12),
    productTitle: 'Tee',
    attributes: { size: 'M' },
    unitPrice: vnd(100_000),
    quantity: 2,
    lineTotal: vnd(200_000),
  };
  const sub = {
    id: ulid(5),
    orderId: ulid(4),
    vendorId: ulid(3),
    vendorName: 'Shop A',
    status: 'PAID',
    items: [item],
    subtotal: vnd(200_000),
    shipping: vnd(30_000),
    vendorDiscount: vnd(0),
    platformDiscount: vnd(0),
    total: vnd(230_000),
    shippingMethodName: 'Standard',
    shippingAddress: addr,
    carrier: null,
    trackingNumber: null,
    shippedAt: null,
    deliveredAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: at,
  };
  const order = {
    id: ulid(4),
    status: 'PAID',
    itemsTotal: vnd(200_000),
    shippingTotal: vnd(30_000),
    discountTotal: vnd(0),
    grandTotal: vnd(230_000),
    paymentDeadlineAt: null,
    subOrders: [sub],
    createdAt: at,
  };

  it('order and sub-order: valid and invalid', () => {
    expect(OrderSchema.safeParse(order).success).toBe(true);
    expect(SubOrderSchema.safeParse(sub).success).toBe(true);
    expect(
      SubOrderSchema.safeParse({ ...sub, total: { amount: 1.5, currency: 'VND' } }).success,
    ).toBe(false);
    expect(OrderSchema.safeParse({ ...order, status: 'SHIPPED' }).success).toBe(false);
    expect(OrderSchema.safeParse({ ...order, createdAt: 'yesterday' }).success).toBe(false);
  });

  it('summary, payment session, ship', () => {
    const summary = {
      id: ulid(4),
      status: 'PAID',
      grandTotal: vnd(1),
      itemCount: 2,
      subOrderCount: 1,
      createdAt: at,
    };
    expect(OrderSummarySchema.safeParse(summary).success).toBe(true);
    expect(OrderSummarySchema.safeParse({ ...summary, subOrderCount: 0 }).success).toBe(false);
    expect(
      PaymentSessionSchema.safeParse({ status: 'PENDING', redirectUrl: null, expiresAt: null })
        .success,
    ).toBe(true);
    expect(
      PaymentSessionSchema.safeParse({ status: 'PENDING', redirectUrl: 'ftp://x', expiresAt: null })
        .success,
    ).toBe(false);
    expect(SubOrderShipSchema.safeParse({ carrier: 'GHN', trackingNumber: 'X1' }).success).toBe(
      true,
    );
    expect(SubOrderShipSchema.safeParse({ carrier: 'GHN', trackingNumber: ' ' }).success).toBe(
      false,
    );
  });
});

describe('shipping method', () => {
  it('input defaults isActive and rejects negative price', () => {
    const ok = ShippingMethodInputSchema.parse({ name: 'Fast', price: vnd(25_000), estDays: 2 });
    expect(ok.isActive).toBe(true);
    expect(
      ShippingMethodInputSchema.safeParse({ name: 'Fast', price: vnd(-1), estDays: 2 }).success,
    ).toBe(false);
    expect(
      ShippingMethodInputSchema.safeParse({ name: 'Fast', price: vnd(1), estDays: 0 }).success,
    ).toBe(false);
    expect(
      ShippingMethodSchema.safeParse({
        id: ulid(1),
        vendorId: ulid(2),
        name: 'F',
        price: vnd(1),
        estDays: 2,
        isActive: true,
      }).success,
    ).toBe(true);
  });
});

describe('coupon', () => {
  const base = { code: 'SAVE10', startsAt: at, endsAt: later };

  it('accepts percent in bps and fixed money; applies defaults', () => {
    const p = CouponInputSchema.parse({ ...base, discountType: 'PERCENT', discountBps: 1000 });
    expect(p).toMatchObject({
      isActive: true,
      minSpend: null,
      maxRedemptions: null,
      perUserLimit: null,
    });
    expect(
      CouponInputSchema.safeParse({
        ...base,
        discountType: 'FIXED',
        discount: vnd(50_000),
        minSpend: vnd(200_000),
      }).success,
    ).toBe(true);
  });

  it.each([
    ['percent above 100%', { discountType: 'PERCENT', discountBps: 10_001 }],
    ['fractional percent', { discountType: 'PERCENT', discountBps: 12.5 }],
    ['zero fixed', { discountType: 'FIXED', discount: vnd(0) }],
    ['fixed without money', { discountType: 'FIXED', discountBps: 100 }],
    [
      'ends before start',
      { discountType: 'PERCENT', discountBps: 100, startsAt: later, endsAt: at },
    ],
    [
      'min spend currency mismatch',
      { discountType: 'FIXED', discount: vnd(1000), minSpend: { amount: 10, currency: 'USD' } },
    ],
  ])('rejects %s', (_l, extra) => {
    expect(CouponInputSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });

  it('read shape', () => {
    const read = {
      ...base,
      id: ulid(1),
      scope: 'VENDOR',
      vendorId: ulid(2),
      redemptionCount: 0,
      minSpend: null,
      maxRedemptions: null,
      perUserLimit: null,
      isActive: true,
      discountType: 'PERCENT',
      discountBps: 500,
    };
    expect(CouponSchema.safeParse(read).success).toBe(true);
    expect(CouponSchema.safeParse({ ...read, scope: 'ALL' }).success).toBe(false);
  });
});

describe('review', () => {
  it('create: rating bounds, blank body → undefined', () => {
    const ok = ReviewCreateSchema.parse({
      subOrderId: ulid(1),
      productId: ulid(2),
      rating: 5,
      body: '  ',
    });
    expect(ok.body).toBeUndefined();
    expect(
      ReviewCreateSchema.safeParse({ subOrderId: ulid(1), productId: ulid(2), rating: 6 }).success,
    ).toBe(false);
    expect(
      ReviewCreateSchema.safeParse({ subOrderId: ulid(1), productId: ulid(2), rating: 4.5 })
        .success,
    ).toBe(false);
  });

  it('create body: trims, caps length, rejects out-of-range rating', () => {
    const ok = ReviewCreateBodySchema.parse({ subOrderId: ulid(1), rating: 3, body: '  good  ' });
    expect(ok.body).toBe('good');
    expect(ReviewCreateBodySchema.safeParse({ subOrderId: ulid(1), rating: 0 }).success).toBe(
      false,
    );
    expect(
      ReviewCreateBodySchema.safeParse({ subOrderId: ulid(1), rating: 5, body: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
  });

  it('page: items + nextCursor + summary', () => {
    const summary = { average: null, count: 0, distribution: [0, 0, 0, 0, 0] };
    expect(ReviewPageSchema.safeParse({ items: [], nextCursor: null, summary }).success).toBe(true);
    expect(ReviewPageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(false);
  });

  it('read + summary', () => {
    expect(
      ReviewSchema.safeParse({
        id: ulid(1),
        productId: ulid(2),
        authorName: 'A',
        rating: 4,
        body: null,
        createdAt: at,
      }).success,
    ).toBe(true);
    expect(
      RatingSummarySchema.safeParse({ average: 4.5, count: 2, distribution: [0, 0, 0, 1, 1] })
        .success,
    ).toBe(true);
    expect(
      RatingSummarySchema.safeParse({ average: 4.5, count: 2, distribution: [0, 0, 1, 1] }).success,
    ).toBe(false);
  });
});

describe('platform settings', () => {
  it('public and full read', () => {
    expect(
      PlatformSettingsPublicSchema.safeParse({
        supportedCurrencies: ['VND'],
        defaultCurrency: 'VND',
        maxCouponStack: 1,
      }).success,
    ).toBe(true);
    expect(
      PlatformSettingsPublicSchema.safeParse({
        supportedCurrencies: [],
        defaultCurrency: 'VND',
        maxCouponStack: 1,
      }).success,
    ).toBe(false);
    const full = {
      id: ulid(1),
      commissionBps: 1000,
      holdPeriodDays: 7,
      refundWindowDays: 7,
      maxCouponStack: 1,
      paymentTimeoutMinutes: 30,
      supportedCurrencies: ['VND', 'USD'],
      defaultCurrency: 'VND',
      updatedAt: at,
    };
    expect(PlatformSettingsSchema.safeParse(full).success).toBe(true);
    expect(PlatformSettingsSchema.safeParse({ ...full, commissionBps: 10.5 }).success).toBe(false);
  });

  it('update: partial, non-empty, consistent currencies', () => {
    expect(PlatformSettingsUpdateSchema.safeParse({ commissionBps: 1200 }).success).toBe(true);
    expect(PlatformSettingsUpdateSchema.safeParse({}).success).toBe(false);
    expect(PlatformSettingsUpdateSchema.safeParse({ commissionBps: 10_001 }).success).toBe(false);
    expect(PlatformSettingsUpdateSchema.safeParse({ paymentTimeoutMinutes: 1 }).success).toBe(
      false,
    );
    expect(
      PlatformSettingsUpdateSchema.safeParse({
        supportedCurrencies: ['VND'],
        defaultCurrency: 'USD',
      }).success,
    ).toBe(false);
    expect(
      PlatformSettingsUpdateSchema.safeParse({ supportedCurrencies: ['VND', 'VND'] }).success,
    ).toBe(false);
  });
});

describe('wallet and ledger', () => {
  it('wallet balance is non-negative; ledger amount is signed', () => {
    expect(
      WalletSchema.safeParse({ id: ulid(1), vendorId: ulid(2), balance: vnd(0) }).success,
    ).toBe(true);
    expect(
      WalletSchema.safeParse({ id: ulid(1), vendorId: ulid(2), balance: vnd(-1) }).success,
    ).toBe(false);
    const entry = {
      id: ulid(1),
      txnGroupId: ulid(9),
      account: 'CUSTOMER',
      entryType: 'ESCROW_IN',
      amount: vnd(-100),
      orderId: null,
      subOrderId: null,
      createdAt: at,
    };
    expect(LedgerEntrySchema.safeParse(entry).success).toBe(true);
    expect(LedgerEntrySchema.safeParse({ ...entry, account: 'BANK' }).success).toBe(false);
  });
});

describe('refund', () => {
  it('create needs a reason; read shape', () => {
    expect(RefundCreateSchema.safeParse({ reason: 'Damaged' }).success).toBe(true);
    expect(RefundCreateSchema.safeParse({ reason: ' ' }).success).toBe(false);
    const refund = {
      id: ulid(1),
      subOrderId: ulid(2),
      paymentId: ulid(3),
      amount: vnd(1000),
      status: 'PENDING',
      reason: 'x',
      providerRefundId: null,
      requestedById: ulid(4),
      createdAt: at,
      updatedAt: at,
    };
    expect(RefundSchema.safeParse(refund).success).toBe(true);
    expect(RefundSchema.safeParse({ ...refund, status: 'DONE' }).success).toBe(false);
  });
});

describe('vendor invitation', () => {
  it('lowercases email; rejects bad email and short token', () => {
    expect(VendorInvitationCreateSchema.parse({ email: 'Staff@Example.COM' }).email).toBe(
      'staff@example.com',
    );
    expect(VendorInvitationCreateSchema.safeParse({ email: 'nope' }).success).toBe(false);
    expect(VendorInvitationAcceptSchema.safeParse({ token: 'a'.repeat(43) }).success).toBe(true);
    expect(VendorInvitationAcceptSchema.safeParse({ token: 'short' }).success).toBe(false);
    expect(
      VendorInvitationSchema.safeParse({
        id: ulid(1),
        vendorId: ulid(2),
        email: 'a@b.co',
        status: 'PENDING',
        expiresAt: later,
        acceptedAt: null,
        revokedAt: null,
        createdAt: at,
      }).success,
    ).toBe(true);
  });

  it('validates the created event payload and a staff member', () => {
    expect(
      VendorInvitationCreatedEventSchema.safeParse({
        invitationId: ulid(1),
        vendorId: ulid(2),
        email: 'a@b.co',
        token: 'x'.repeat(43),
      }).success,
    ).toBe(true);
    expect(VendorInvitationCreatedEventSchema.safeParse({ invitationId: ulid(1) }).success).toBe(
      false,
    );
    expect(
      VendorStaffMemberSchema.safeParse({
        userId: ulid(1),
        name: 'A',
        email: null,
        role: 'CUSTOMER',
        joinedAt: at,
      }).success,
    ).toBe(false);
  });
});

describe('product upsert', () => {
  const upsert = {
    translations: [
      { locale: 'VI', name: 'Áo thun', slug: 'ao-thun' },
      { locale: 'EN', name: 'T-shirt', slug: 't-shirt', description: '' },
    ],
    basePrice: vnd(100_000),
    variants: [{ sku: 'TEE-M', attributes: { size: 'M' }, price: vnd(100_000), stockOnHand: 5 }],
    images: [{ id: ulid(7) }, { key: 'media/v1/a.jpg', alt: 'front' }],
    categoryIds: [ulid(8)],
  };

  it('accepts a full upsert and applies defaults', () => {
    const parsed = ProductUpsertSchema.parse(upsert);
    expect(parsed.status).toBe('DRAFT');
    expect(parsed.translations[1]?.description).toBeUndefined();
    expect(ProductUpsertSchema.parse({ ...upsert, images: undefined }).images).toEqual([]);
  });

  it.each([
    ['one locale only', { translations: [upsert.translations[0]] }],
    ['duplicate locale', { translations: [upsert.translations[0], upsert.translations[0]] }],
    ['no variants', { variants: [] }],
    ['duplicate sku', { variants: [upsert.variants[0], upsert.variants[0]] }],
    ['negative stock', { variants: [{ ...upsert.variants[0], stockOnHand: -1 }] }],
    [
      'currency mismatch',
      { variants: [{ ...upsert.variants[0], price: { amount: 5, currency: 'USD' } }] },
    ],
    ['vendor sets BLOCKED', { status: 'BLOCKED' }],
    ['no category', { categoryIds: [] }],
    ['image with neither id nor key', { images: [{ alt: 'x' }] }],
  ])('rejects %s', (_l, patch) => {
    expect(ProductUpsertSchema.safeParse({ ...upsert, ...patch }).success).toBe(false);
  });

  it('vendor status excludes BLOCKED', () => {
    expect(VendorProductStatusSchema.safeParse('ACTIVE').success).toBe(true);
    expect(VendorProductStatusSchema.safeParse('BLOCKED').success).toBe(false);
  });
});
