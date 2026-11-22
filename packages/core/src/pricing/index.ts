import type { Currency, LedgerAccount } from '../enums';
import { DomainError, type ErrorCode } from '../errors';
import type { VendorId } from '../ids';
import * as M from '../money';
import type { Money } from '../schemas/money';
import type { Coupon } from '../schemas/coupon';

// Pricing engine: every money formula of checkout and payout, as pure functions (no I/O, no
// clock — `now` is a parameter). Rules come from roadmap decisions D5-D8:
//
// - Coupons discount ITEM subtotals only, never shipping.
// - A vendor coupon applies only to its own vendor's sub-order; at most ONE vendor coupon per
//   vendor. PERCENT discounts are rounded DOWN (floor); FIXED is capped at its base.
// - Platform coupons are computed on the order's items total after vendor discounts, in the
//   given order, each on what the previous ones left; the total is then split across
//   sub-orders with `Money.allocate` (largest remainder) in proportion to
//   (subtotal − vendorDiscount), so no sub-order's item base goes below 0.
// - vendor + platform coupon count ≤ `maxCouponStack`.
// - Commission (D5) is per line, in half-even (banker's) rounding — the unbiased mode, so
//   rounding error does not systematically favour the platform or the vendor. Base = line
//   total − the line's pro-rata share of the vendor discount (largest-remainder split of the
//   vendor discount over the lines). The platform's own coupons never reduce the base.
// - One order = one currency; mixing throws `money.error.currency-mismatch`.

export interface CouponEvalContext {
  now: Date;
  /** What the discount applies to (vendor sub-order subtotal, or items total after vendor discounts). */
  base: Money;
  /** Redemptions of this coupon by everyone (loaded by the caller). */
  totalRedemptions: number;
  /** Redemptions of this coupon by the current user (loaded by the caller). */
  userRedemptions: number;
}

export type CouponEvaluation =
  | { ok: true }
  | {
      ok: false;
      code: Extract<
        ErrorCode,
        | 'coupon.error.not-found'
        | 'coupon.error.not-started'
        | 'coupon.error.expired'
        | 'coupon.error.min-spend-not-met'
        | 'coupon.error.usage-limit-reached'
      >;
    };

/**
 * Is `coupon` usable right now for `ctx.base`? An inactive coupon is reported as `not-found`
 * (callers must not leak that it exists). The window is `startsAt <= now < endsAt`.
 */
export function evaluateCoupon(coupon: Coupon, ctx: CouponEvalContext): CouponEvaluation {
  if (!coupon.isActive) return { ok: false, code: 'coupon.error.not-found' };
  const t = ctx.now.getTime();
  const starts = Date.parse(coupon.startsAt);
  const ends = Date.parse(coupon.endsAt);
  // NaN comparisons are always false, which would let a bad date pass as valid: fail closed.
  invariant(!Number.isNaN(t + starts + ends), 'coupon window and now must be valid dates');
  if (t < starts) return { ok: false, code: 'coupon.error.not-started' };
  if (t >= ends) return { ok: false, code: 'coupon.error.expired' };
  if (coupon.minSpend !== null && M.compare(ctx.base, coupon.minSpend) < 0) {
    return { ok: false, code: 'coupon.error.min-spend-not-met' };
  }
  if (coupon.maxRedemptions !== null && ctx.totalRedemptions >= coupon.maxRedemptions) {
    return { ok: false, code: 'coupon.error.usage-limit-reached' };
  }
  if (coupon.perUserLimit !== null && ctx.userRedemptions >= coupon.perUserLimit) {
    return { ok: false, code: 'coupon.error.usage-limit-reached' };
  }
  return { ok: true };
}

/** Discount a coupon gives on `base`: PERCENT floor-rounded, FIXED capped at `base`. Never > base, never < 0. */
export function couponDiscount(coupon: Coupon, base: Money): Money {
  if (coupon.discountType === 'PERCENT') return M.applyBps(base, coupon.discountBps, 'floor');
  return M.compare(coupon.discount, base) > 0 ? base : coupon.discount;
}

/** Commission bps for a line (D5): vendor override wins; else the lowest category override; else the platform rate. */
export function resolveCommissionBps(input: {
  vendorOverride: number | null;
  categoryOverrides: readonly (number | null)[];
  platformBps: number;
}): number {
  if (input.vendorOverride !== null) return input.vendorOverride;
  const overrides = input.categoryOverrides.filter((bps): bps is number => bps !== null);
  return overrides.length > 0 ? Math.min(...overrides) : input.platformBps;
}

export interface PricingLine {
  unitPrice: Money;
  qty: number;
  commissionBps: number;
}

export interface PricingSubOrderInput {
  vendorId: VendorId;
  lines: readonly PricingLine[];
  shipping: Money;
}

/** A coupon plus the usage counts the caller loaded from the DB. */
export interface AppliedCoupon {
  coupon: Coupon;
  totalRedemptions: number;
  userRedemptions: number;
}

export interface PriceOrderInput {
  currency: Currency;
  subOrders: readonly PricingSubOrderInput[];
  /** Each must have scope VENDOR and a `vendorId` of one of the sub-orders; ≤ 1 per vendor. */
  vendorCoupons: readonly AppliedCoupon[];
  /** Each must have scope PLATFORM. */
  platformCoupons: readonly AppliedCoupon[];
  maxCouponStack: number;
  now: Date;
}

export interface PricedSubOrder {
  vendorId: VendorId;
  subtotal: Money;
  shipping: Money;
  vendorDiscount: Money;
  platformDiscount: Money;
  commission: Money;
  /** subtotal + shipping − vendorDiscount − platformDiscount (what the customer pays for this sub-order). */
  paid: Money;
  /** subtotal + shipping − vendorDiscount − commission (what the vendor earns). */
  net: Money;
}

export interface PricedOrder {
  currency: Currency;
  subOrders: PricedSubOrder[];
  /** One entry per applied coupon (platform coupons are order-level), for CouponRedemption rows. */
  redemptions: {
    couponId: Coupon['id'];
    scope: Coupon['scope'];
    vendorId: VendorId | null;
    discount: Money;
  }[];
  itemsTotal: Money;
  shippingTotal: Money;
  /** Σ (vendorDiscount + platformDiscount). */
  discountTotal: Money;
  /** itemsTotal + shippingTotal − discountTotal = Σ paid. */
  grandTotal: Money;
}

function invariant(ok: boolean, what: string): void {
  if (!ok) throw new DomainError('money.error.invalid-operand', { reason: `invariant: ${what}` });
}

function reject(code: ErrorCode, coupon: Coupon): never {
  throw new DomainError(code, { code: coupon.code });
}

const isNeg = M.isNegative;

export function priceOrder(input: PriceOrderInput): PricedOrder {
  const { currency, now } = input;
  const zero = M.zero(currency);

  if (input.vendorCoupons.length + input.platformCoupons.length > input.maxCouponStack) {
    throw new DomainError('coupon.error.stack-limit-exceeded', { max: input.maxCouponStack });
  }

  const vendorIds = input.subOrders.map((s) => s.vendorId);
  invariant(new Set(vendorIds).size === vendorIds.length, 'one sub-order per vendor');
  // The same coupon may not be applied twice (it would bypass perUserLimit / maxRedemptions).
  const couponIds = [...input.vendorCoupons, ...input.platformCoupons].map((a) => a.coupon.id);
  if (new Set(couponIds).size !== couponIds.length) {
    throw new DomainError('coupon.error.stack-limit-exceeded', { reason: 'duplicate-coupon' });
  }

  // 1. Line totals and subtotals.
  const subs = input.subOrders.map((so) => {
    invariant(!isNeg(M.add(so.shipping, zero)), 'shipping must not be negative');
    const lineTotals = so.lines.map((line) => {
      invariant(Number.isSafeInteger(line.qty) && line.qty > 0, 'qty must be a positive integer');
      invariant(!isNeg(line.unitPrice), 'unitPrice must not be negative');
      return M.multiply(M.add(line.unitPrice, zero), line.qty); // `add` enforces currency
    });
    return { so, lineTotals, subtotal: M.sum(lineTotals, currency) };
  });

  // 2. Vendor coupons (one per vendor, only on that vendor's sub-order).
  const seenVendors = new Set<string>();
  const vendorDiscounts = subs.map(() => zero);
  const redemptions: PricedOrder['redemptions'] = [];
  for (const applied of input.vendorCoupons) {
    const { coupon } = applied;
    if (coupon.scope !== 'VENDOR' || coupon.vendorId === null)
      reject('coupon.error.not-found', coupon);
    if (seenVendors.has(coupon.vendorId)) reject('coupon.error.stack-limit-exceeded', coupon);
    seenVendors.add(coupon.vendorId);
    const index = subs.findIndex((s) => s.so.vendorId === coupon.vendorId);
    const sub = subs[index];
    if (sub === undefined) reject('coupon.error.not-found', coupon);
    const verdict = evaluateCoupon(coupon, { now, base: sub.subtotal, ...counts(applied) });
    if (!verdict.ok) reject(verdict.code, coupon);
    const discount = couponDiscount(coupon, sub.subtotal);
    vendorDiscounts[index] = discount;
    redemptions.push({ couponId: coupon.id, scope: 'VENDOR', vendorId: sub.so.vendorId, discount });
  }

  // 3. Platform coupons on the order's items total after vendor discounts.
  const afterVendor = subs.map((s, i) => M.subtract(s.subtotal, vendorDiscounts[i] ?? zero));
  const itemsAfterVendor = M.sum(afterVendor, currency);
  let remaining = itemsAfterVendor;
  let platformTotal = zero;
  for (const applied of input.platformCoupons) {
    const { coupon } = applied;
    if (coupon.scope !== 'PLATFORM') reject('coupon.error.not-found', coupon);
    // Eligibility (minSpend) is judged on the items total after vendor discounts, for every
    // platform coupon alike; only the discount itself is taken from what is `remaining`.
    const verdict = evaluateCoupon(coupon, { now, base: itemsAfterVendor, ...counts(applied) });
    if (!verdict.ok) reject(verdict.code, coupon);
    const discount = couponDiscount(coupon, remaining);
    remaining = M.subtract(remaining, discount);
    platformTotal = M.add(platformTotal, discount);
    redemptions.push({ couponId: coupon.id, scope: 'PLATFORM', vendorId: null, discount });
  }

  // 4. Split the platform discount across sub-orders by (subtotal − vendorDiscount).
  const platformShares =
    platformTotal.amount === 0 || subs.length === 0
      ? subs.map(() => zero)
      : M.allocate(
          platformTotal,
          afterVendor.map((m) => m.amount),
        );

  // 5. Per sub-order: commission, paid, net.
  const priced = subs.map((s, i): PricedSubOrder => {
    const vendorDiscount = vendorDiscounts[i] ?? zero;
    const platformDiscount = platformShares[i] ?? zero;
    invariant(
      M.compare(platformDiscount, afterVendor[i] ?? zero) <= 0,
      'platform share within item base',
    );

    // Vendor discount spread over lines pro-rata (largest remainder), then commission per line.
    const lineDiscounts =
      vendorDiscount.amount === 0 || s.subtotal.amount === 0
        ? s.lineTotals.map(() => zero)
        : M.allocate(
            vendorDiscount,
            s.lineTotals.map((m) => m.amount),
          );
    const commission = M.sum(
      s.so.lines.map((line, j) => {
        const base = M.subtract(s.lineTotals[j] ?? zero, lineDiscounts[j] ?? zero);
        return M.applyBps(base, line.commissionBps, 'half-even');
      }),
      currency,
    );

    const gross = M.add(s.subtotal, s.so.shipping);
    const paid = M.subtract(M.subtract(gross, vendorDiscount), platformDiscount);
    const net = M.subtract(M.subtract(gross, vendorDiscount), commission);
    invariant(!isNeg(paid), 'paid >= 0');
    invariant(!isNeg(net), 'net >= 0');
    invariant(!isNeg(s.so.shipping), 'shipping >= 0');
    return {
      vendorId: s.so.vendorId,
      subtotal: s.subtotal,
      shipping: s.so.shipping,
      vendorDiscount,
      platformDiscount,
      commission,
      paid,
      net,
    };
  });

  const itemsTotal = M.sum(
    priced.map((p) => p.subtotal),
    currency,
  );
  const shippingTotal = M.sum(
    priced.map((p) => p.shipping),
    currency,
  );
  const discountTotal = M.sum(
    priced.flatMap((p) => [p.vendorDiscount, p.platformDiscount]),
    currency,
  );
  const grandTotal = M.subtract(M.add(itemsTotal, shippingTotal), discountTotal);
  invariant(
    M.equals(
      grandTotal,
      M.sum(
        priced.map((p) => p.paid),
        currency,
      ),
    ),
    'grandTotal = Σ paid',
  );

  return {
    currency,
    subOrders: priced,
    redemptions,
    itemsTotal,
    shippingTotal,
    discountTotal,
    grandTotal,
  };
}

function counts(a: AppliedCoupon): Pick<CouponEvalContext, 'totalRedemptions' | 'userRedemptions'> {
  return { totalRedemptions: a.totalRedemptions, userRedemptions: a.userRedemptions };
}

export interface PayoutPosting {
  account: Extract<LedgerAccount, 'PLATFORM_ESCROW' | 'VENDOR_WALLET' | 'PLATFORM_REVENUE'>;
  /** Signed: negative = debit out of the account. */
  amount: Money;
}

/**
 * Ledger postings when a sub-order's payout is released (D7): escrow gives up `paid`, the vendor
 * wallet gains `net`, platform revenue gains `commission − platformDiscount` (negative when the
 * platform funded a coupon bigger than its commission). Always sums to zero.
 */
export function computePayoutPostings(
  so: Pick<PricedSubOrder, 'paid' | 'net' | 'commission' | 'platformDiscount'>,
): [PayoutPosting, PayoutPosting, PayoutPosting] {
  const revenue = M.subtract(so.commission, so.platformDiscount);
  const escrow = M.subtract(M.zero(so.paid.currency), so.paid);
  invariant(
    M.isZero(M.add(M.add(escrow, so.net), revenue)),
    'payout postings sum to zero (paid = net + commission − platformDiscount)',
  );
  return [
    { account: 'PLATFORM_ESCROW', amount: escrow },
    { account: 'VENDOR_WALLET', amount: so.net },
    { account: 'PLATFORM_REVENUE', amount: revenue },
  ];
}
