import {
  type Currency,
  Money,
  type ProductStatus,
  Role,
  type Locale,
  VendorStatus,
} from '@repo/core';
import { toDbAmount } from '@repo/db';
import { monotonicFactory } from 'ulid';
import type { Db } from './test-app';

/**
 * Test data factories over the real schema. Every factory takes the TestApp's `db`, generates
 * ULIDs + unique slugs/emails, and returns the created rows. Amounts are integer minor units
 * (VND đồng / USD cents), converted to BIGINT via `toDbAmount`.
 *
 * Ids are monotonic: rows created later always sort after earlier ones, even within the same
 * millisecond — cursor-pagination and "newest first" assertions can rely on creation order.
 */
const ulid = monotonicFactory();

const VENDOR_ROLES: ReadonlySet<Role> = new Set([Role.VENDOR_OWNER, Role.VENDOR_STAFF]);

const unique = (): string => ulid().toLowerCase();
const dbAmount = (amount: number, currency: Currency): bigint =>
  toDbAmount(Money.of(amount, currency));

export interface MakeUserOptions {
  /** Default `['CUSTOMER']`. Vendor roles need `vendorId`. */
  roles?: readonly Role[];
  vendorId?: string;
  email?: string | null;
  name?: string;
  primaryLocale?: Locale;
}

export async function makeUser(db: Db, options: MakeUserOptions = {}) {
  const roles = options.roles ?? [Role.CUSTOMER];
  if (roles.some((role) => VENDOR_ROLES.has(role)) && !options.vendorId) {
    throw new Error('makeUser: vendor roles need a vendorId');
  }
  const id = ulid();
  return db.user.create({
    data: {
      id,
      email: options.email === undefined ? `user-${id.toLowerCase()}@example.com` : options.email,
      name: options.name ?? 'Test User',
      primaryLocale: options.primaryLocale ?? 'VI',
      roles: {
        create: roles.map((role) => ({
          id: ulid(),
          role,
          vendorId: VENDOR_ROLES.has(role) ? (options.vendorId ?? null) : null,
        })),
      },
    },
  });
}

export interface MakeVendorOptions {
  /** Default ACTIVE. */
  status?: VendorStatus;
  /** Existing user to own the vendor; default: a new CUSTOMER user. */
  ownerId?: string;
  displayName?: string;
  commissionBpsOverride?: number | null;
  /** Wallet currency, default VND. */
  currency?: Currency;
}

/** Vendor + Wallet + the owner's `VENDOR_OWNER` role (owner created unless `ownerId` given). */
export async function makeVendor(db: Db, options: MakeVendorOptions = {}) {
  const ownerId = options.ownerId ?? (await makeUser(db)).id;
  const id = ulid();
  const vendor = await db.vendor.create({
    data: {
      id,
      ownerId,
      slug: `vendor-${unique()}`,
      displayName: options.displayName ?? 'Test Vendor',
      status: options.status ?? VendorStatus.ACTIVE,
      commissionBpsOverride: options.commissionBpsOverride ?? null,
      wallet: { create: { id: ulid(), balanceCurrency: options.currency ?? 'VND' } },
      staffRoles: { create: { id: ulid(), userId: ownerId, role: Role.VENDOR_OWNER } },
    },
    include: { wallet: true, owner: true },
  });
  const { wallet, owner, ...rest } = vendor;
  if (!wallet) throw new Error('makeVendor: wallet not created');
  return { vendor: rest, owner, wallet };
}

export interface MakeCategoryOptions {
  parentId?: string | null;
  commissionBpsOverride?: number | null;
  name?: string;
}

/** Category with vi + en translations (unique slugs). */
export async function makeCategory(db: Db, options: MakeCategoryOptions = {}) {
  const slug = `category-${unique()}`;
  const name = options.name ?? 'Test Category';
  return db.category.create({
    data: {
      id: ulid(),
      parentId: options.parentId ?? null,
      commissionBpsOverride: options.commissionBpsOverride ?? null,
      translations: {
        create: [
          { id: ulid(), locale: 'VI', name: `${name} (vi)`, slug },
          { id: ulid(), locale: 'EN', name, slug },
        ],
      },
    },
    include: { translations: true },
  });
}

export interface MakeVariantOptions {
  /** Minor units; default the product price. */
  price?: number;
  stockOnHand?: number;
  stockReserved?: number;
  sku?: string;
  attributes?: Record<string, string>;
}

export interface MakeProductOptions {
  vendorId: string;
  /** Default ACTIVE. */
  status?: ProductStatus;
  currency?: Currency;
  /** Minor units, default 100_000. */
  price?: number;
  /** One variant per entry; default a single variant with stock 10. */
  variants?: readonly MakeVariantOptions[];
  categoryIds?: readonly string[];
  name?: string;
}

/** Product + vi/en translations + variants (with stock) + one image + optional categories. */
export async function makeProduct(db: Db, options: MakeProductOptions) {
  const currency = options.currency ?? 'VND';
  const price = options.price ?? 100_000;
  const name = options.name ?? 'Test Product';
  const slug = `product-${unique()}`;
  const variants = options.variants ?? [{}];
  return db.product.create({
    data: {
      id: ulid(),
      vendorId: options.vendorId,
      status: options.status ?? 'ACTIVE',
      basePriceAmount: dbAmount(price, currency),
      basePriceCurrency: currency,
      primaryImageUrl: 'https://cdn.example.com/test.jpg',
      translations: {
        create: [
          { id: ulid(), locale: 'VI', name: `${name} (vi)`, slug, description: null },
          { id: ulid(), locale: 'EN', name, slug, description: null },
        ],
      },
      variants: {
        create: variants.map((variant) => ({
          id: ulid(),
          sku: variant.sku ?? `SKU-${unique()}`,
          attributes: variant.attributes ?? {},
          priceAmount: dbAmount(variant.price ?? price, currency),
          priceCurrency: currency,
          stockOnHand: variant.stockOnHand ?? 10,
          stockReserved: variant.stockReserved ?? 0,
        })),
      },
      images: { create: { id: ulid(), url: 'https://cdn.example.com/test.jpg', sortOrder: 0 } },
      categories: { create: (options.categoryIds ?? []).map((categoryId) => ({ categoryId })) },
    },
    include: { translations: true, variants: { orderBy: { id: 'asc' } }, images: true },
  });
}

export interface MakeShippingMethodOptions {
  vendorId: string;
  currency?: Currency;
  /** Minor units, default 30_000. */
  price?: number;
  estDays?: number;
  isActive?: boolean;
  name?: string;
}

export async function makeShippingMethod(db: Db, options: MakeShippingMethodOptions) {
  const currency = options.currency ?? 'VND';
  return db.shippingMethod.create({
    data: {
      id: ulid(),
      vendorId: options.vendorId,
      name: options.name ?? 'Standard',
      priceAmount: dbAmount(options.price ?? 30_000, currency),
      priceCurrency: currency,
      estDays: options.estDays ?? 3,
      isActive: options.isActive ?? true,
    },
  });
}

export interface MakeAddressOptions {
  userId: string;
  isDefault?: boolean;
  country?: string;
}

export async function makeAddress(db: Db, options: MakeAddressOptions) {
  return db.address.create({
    data: {
      id: ulid(),
      userId: options.userId,
      recipientName: 'Nguyễn Văn A',
      phone: '0901234567',
      line1: '1 Lê Lợi',
      ward: 'Bến Nghé',
      district: 'Quận 1',
      city: 'Hồ Chí Minh',
      country: options.country ?? 'VN',
      isDefault: options.isDefault ?? false,
    },
  });
}

export interface MakePlatformSettingsOptions {
  commissionBps?: number;
  holdPeriodDays?: number;
  refundWindowDays?: number;
  maxCouponStack?: number;
}

export interface MakeCouponOptions {
  /** VENDOR coupons need `vendorId`; default PLATFORM. */
  scope?: 'PLATFORM' | 'VENDOR';
  vendorId?: string;
  code?: string;
  /** FIXED: minor units of `currency`; PERCENT: basis points (1000 = 10%). Default PERCENT 1000. */
  discountType?: 'PERCENT' | 'FIXED';
  discountValue?: number;
  /** Default VND; null = currency-agnostic PERCENT coupon. */
  currency?: Currency | null;
  minSpend?: number | null;
  maxRedemptions?: number | null;
  perUserLimit?: number | null;
  isActive?: boolean;
  startsAt?: Date;
  endsAt?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Coupon valid from yesterday for a year by default (PLATFORM, PERCENT 10%, unlimited). */
export async function makeCoupon(db: Db, options: MakeCouponOptions = {}) {
  const scope = options.scope ?? 'PLATFORM';
  if (scope === 'VENDOR' && !options.vendorId) {
    throw new Error('makeCoupon: VENDOR coupons need a vendorId');
  }
  const currency = options.currency === undefined ? 'VND' : options.currency;
  const minSpend = options.minSpend ?? null;
  return db.coupon.create({
    data: {
      id: ulid(),
      scope,
      vendorId: scope === 'VENDOR' ? (options.vendorId ?? null) : null,
      code: options.code ?? `CODE-${unique().toUpperCase()}`,
      discountType: options.discountType ?? 'PERCENT',
      discountValue: BigInt(options.discountValue ?? 1000),
      currency,
      minSpendAmount: minSpend === null ? null : BigInt(minSpend),
      maxRedemptions: options.maxRedemptions ?? null,
      perUserLimit: options.perUserLimit ?? null,
      isActive: options.isActive ?? true,
      startsAt: options.startsAt ?? new Date(Date.now() - DAY_MS),
      endsAt: options.endsAt ?? new Date(Date.now() + 365 * DAY_MS),
    },
  });
}

/** The PlatformSettings singleton (created once; later calls update the given fields). */
export async function makePlatformSettings(db: Db, options: MakePlatformSettingsOptions = {}) {
  const existing = await db.platformSettings.findFirst();
  if (existing) return db.platformSettings.update({ where: { id: existing.id }, data: options });
  return db.platformSettings.create({
    data: {
      id: ulid(),
      supportedCurrencies: ['VND', 'USD'],
      defaultCurrency: 'VND',
      ...options,
    },
  });
}
