import { describe, expect, it } from 'vitest';
import { VendorIdSchema } from '../src/ids';
import { DomainError, type ErrorCode } from '../src/errors';
import { equals, of, type Money } from '../src/money';
import {
  computePayoutPostings,
  evaluateCoupon,
  priceOrder,
  resolveCommissionBps,
  type AppliedCoupon,
  type PriceOrderInput,
  type PricingSubOrderInput,
} from '../src/pricing';
import { CouponSchema, type Coupon } from '../src/schemas/coupon';
import { ulid } from './fixtures';

const vnd = (n: number): Money => of(n, 'VND');
const V1 = VendorIdSchema.parse(ulid(1));
const V2 = VendorIdSchema.parse(ulid(2));
const V3 = VendorIdSchema.parse(ulid(3));
const NOW = new Date('2026-06-15T00:00:00Z');

let couponSeq = 100;
// Built through CouponSchema.parse so fixtures are real, correctly typed Coupons (no casts).
function coupon(over: Record<string, unknown>): Coupon {
  couponSeq += 1;
  return CouponSchema.parse({
    id: ulid(couponSeq),
    scope: 'PLATFORM',
    vendorId: null,
    redemptionCount: 0,
    minSpend: null,
    maxRedemptions: null,
    perUserLimit: null,
    isActive: true,
    code: `C${couponSeq}`,
    startsAt: '2026-01-01T00:00:00.000Z',
    endsAt: '2026-12-31T00:00:00.000Z',
    discountType: 'PERCENT',
    discountBps: 1000,
    ...over,
  });
}
const applied = (c: Coupon, totalRedemptions = 0, userRedemptions = 0): AppliedCoupon => ({
  coupon: c,
  totalRedemptions,
  userRedemptions,
});
const percent = (bps: number, over: Record<string, unknown> = {}): Coupon =>
  coupon({ discountType: 'PERCENT', discountBps: bps, ...over });
const fixed = (amount: number, over: Record<string, unknown> = {}): Coupon =>
  coupon({ discountType: 'FIXED', discount: vnd(amount), ...over });
const vendorScope = (vendorId: typeof V1) => ({ scope: 'VENDOR', vendorId });

function so(
  vendorId: typeof V1,
  lines: [number, number, number][],
  shipping = 0,
): PricingSubOrderInput {
  return {
    vendorId,
    lines: lines.map(([price, qty, commissionBps]) => ({
      unitPrice: vnd(price),
      qty,
      commissionBps,
    })),
    shipping: vnd(shipping),
  };
}
function input(
  over: Partial<PriceOrderInput> & Pick<PriceOrderInput, 'subOrders'>,
): PriceOrderInput {
  return {
    currency: 'VND',
    vendorCoupons: [],
    platformCoupons: [],
    maxCouponStack: 5,
    now: NOW,
    ...over,
  };
}
function code(fn: () => unknown): ErrorCode {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  throw new Error('did not throw');
}

describe('resolveCommissionBps', () => {
  it('vendor override wins, even over lower category overrides and 0', () => {
    expect(
      resolveCommissionBps({ vendorOverride: 500, categoryOverrides: [100], platformBps: 1000 }),
    ).toBe(500);
    expect(
      resolveCommissionBps({ vendorOverride: 0, categoryOverrides: [100], platformBps: 1000 }),
    ).toBe(0);
  });
  it('takes the lowest category override, ignoring nulls', () => {
    expect(
      resolveCommissionBps({
        vendorOverride: null,
        categoryOverrides: [800, null, 300],
        platformBps: 1000,
      }),
    ).toBe(300);
  });
  it('falls back to the platform rate', () => {
    expect(
      resolveCommissionBps({ vendorOverride: null, categoryOverrides: [null], platformBps: 1000 }),
    ).toBe(1000);
    expect(
      resolveCommissionBps({ vendorOverride: null, categoryOverrides: [], platformBps: 1000 }),
    ).toBe(1000);
  });
});

describe('evaluateCoupon', () => {
  const ctx = { now: NOW, base: vnd(100_000), totalRedemptions: 0, userRedemptions: 0 };
  it('accepts a valid coupon (window is [startsAt, endsAt))', () => {
    expect(evaluateCoupon(percent(1000), ctx)).toEqual({ ok: true });
    const c = percent(1000, { startsAt: NOW.toISOString() });
    expect(evaluateCoupon(c, ctx).ok).toBe(true);
  });
  it('rejects not started / expired (endsAt exclusive)', () => {
    expect(evaluateCoupon(percent(1000, { startsAt: '2026-07-01T00:00:00.000Z' }), ctx)).toEqual({
      ok: false,
      code: 'coupon.error.not-started',
    });
    expect(evaluateCoupon(percent(1000, { endsAt: NOW.toISOString() }), ctx)).toEqual({
      ok: false,
      code: 'coupon.error.expired',
    });
  });
  it('rejects below min spend, accepts exactly at it', () => {
    const c = percent(1000, { minSpend: vnd(100_001) });
    expect(evaluateCoupon(c, ctx)).toEqual({ ok: false, code: 'coupon.error.min-spend-not-met' });
    expect(evaluateCoupon(percent(1000, { minSpend: vnd(100_000) }), ctx).ok).toBe(true);
  });
  it('rejects total and per-user limits at the boundary', () => {
    const c = percent(1000, { maxRedemptions: 5, perUserLimit: 2 });
    expect(evaluateCoupon(c, { ...ctx, totalRedemptions: 4, userRedemptions: 1 }).ok).toBe(true);
    expect(evaluateCoupon(c, { ...ctx, totalRedemptions: 5 })).toEqual({
      ok: false,
      code: 'coupon.error.usage-limit-reached',
    });
    expect(evaluateCoupon(c, { ...ctx, userRedemptions: 2 })).toEqual({
      ok: false,
      code: 'coupon.error.usage-limit-reached',
    });
  });
  it('reports an inactive coupon as not-found; min-spend in another currency throws', () => {
    expect(evaluateCoupon(percent(1000, { isActive: false }), ctx)).toEqual({
      ok: false,
      code: 'coupon.error.not-found',
    });
    expect(code(() => evaluateCoupon(percent(1000, { minSpend: of(1, 'USD') }), ctx))).toBe(
      'money.error.currency-mismatch',
    );
  });
});

describe('priceOrder', () => {
  it('single vendor, no coupons', () => {
    const r = priceOrder(
      input({
        subOrders: [
          so(
            V1,
            [
              [100_000, 2, 1000],
              [50_000, 1, 500],
            ],
            30_000,
          ),
        ],
      }),
    );
    const s = r.subOrders[0]!;
    expect(s.subtotal).toEqual(vnd(250_000));
    expect(s.commission).toEqual(vnd(22_500)); // 20_000 + 2_500
    expect(s.paid).toEqual(vnd(280_000));
    expect(s.net).toEqual(vnd(257_500));
    expect(r).toMatchObject({
      itemsTotal: vnd(250_000),
      shippingTotal: vnd(30_000),
      discountTotal: vnd(0),
      grandTotal: vnd(280_000),
    });
  });

  it('two vendors, coupons apply per scope', () => {
    const r = priceOrder(
      input({
        subOrders: [so(V1, [[100_000, 1, 1000]], 10_000), so(V2, [[300_000, 1, 500]], 20_000)],
        vendorCoupons: [applied(percent(1000, vendorScope(V2)))],
      }),
    );
    expect(r.subOrders[0]!.vendorDiscount).toEqual(vnd(0));
    expect(r.subOrders[1]!.vendorDiscount).toEqual(vnd(30_000));
    expect(r.subOrders[1]!.commission).toEqual(vnd(13_500)); // 5% of 270_000
    expect(r.subOrders[1]!.net).toEqual(vnd(300_000 + 20_000 - 30_000 - 13_500));
    expect(r.redemptions).toHaveLength(1);
    expect(r.redemptions[0]).toMatchObject({
      scope: 'VENDOR',
      vendorId: V2,
      discount: vnd(30_000),
    });
  });

  it('vendor + platform coupon: platform does not reduce the commission base', () => {
    const r = priceOrder(
      input({
        subOrders: [so(V1, [[100_000, 1, 1000]], 0), so(V2, [[100_000, 1, 1000]], 0)],
        vendorCoupons: [applied(fixed(20_000, vendorScope(V1)))],
        platformCoupons: [applied(percent(1000))],
      }),
    );
    // after vendor: 80_000 + 100_000 = 180_000; platform 10% = 18_000, split 8_000 / 10_000
    const [a, b] = r.subOrders;
    expect(a!.platformDiscount).toEqual(vnd(8_000));
    expect(b!.platformDiscount).toEqual(vnd(10_000));
    expect(a!.commission).toEqual(vnd(8_000)); // 10% of 80_000
    expect(b!.commission).toEqual(vnd(10_000));
    expect(a!.paid).toEqual(vnd(100_000 - 20_000 - 8_000));
    expect(r.discountTotal).toEqual(vnd(20_000 + 18_000));
    expect(r.grandTotal).toEqual(vnd(200_000 - 38_000));
  });

  it('coupons never touch shipping', () => {
    const r = priceOrder(
      input({
        subOrders: [so(V1, [[10_000, 1, 1000]], 50_000)],
        platformCoupons: [applied(fixed(1_000_000))],
      }),
    );
    expect(r.subOrders[0]!.platformDiscount).toEqual(vnd(10_000));
    expect(r.subOrders[0]!.paid).toEqual(vnd(50_000));
  });

  it('rejects too many coupons with stack-limit-exceeded', () => {
    const base = { subOrders: [so(V1, [[100_000, 1, 1000]])], maxCouponStack: 1 };
    expect(
      code(() =>
        priceOrder(
          input({
            ...base,
            vendorCoupons: [applied(percent(100, vendorScope(V1)))],
            platformCoupons: [applied(percent(100))],
          }),
        ),
      ),
    ).toBe('coupon.error.stack-limit-exceeded');
    expect(() =>
      priceOrder(input({ ...base, platformCoupons: [applied(percent(100))] })),
    ).not.toThrow();
  });

  it('allows only one vendor coupon per vendor', () => {
    const r = () =>
      priceOrder(
        input({
          subOrders: [so(V1, [[100_000, 1, 1000]])],
          vendorCoupons: [
            applied(percent(100, vendorScope(V1))),
            applied(fixed(1_000, vendorScope(V1))),
          ],
        }),
      );
    expect(code(r)).toBe('coupon.error.stack-limit-exceeded');
  });

  it('rejects a vendor coupon for a vendor not in the order, and wrong-scope coupons', () => {
    const subOrders = [so(V1, [[100_000, 1, 1000]])];
    expect(
      code(() =>
        priceOrder(input({ subOrders, vendorCoupons: [applied(percent(100, vendorScope(V3)))] })),
      ),
    ).toBe('coupon.error.not-found');
    expect(
      code(() => priceOrder(input({ subOrders, vendorCoupons: [applied(percent(100))] }))),
    ).toBe('coupon.error.not-found');
    expect(
      code(() =>
        priceOrder(input({ subOrders, platformCoupons: [applied(percent(100, vendorScope(V1)))] })),
      ),
    ).toBe('coupon.error.not-found');
  });

  it('surfaces evaluateCoupon rejections (min spend on the vendor base, platform base after vendor discount)', () => {
    const subOrders = [so(V1, [[100_000, 1, 1000]])];
    expect(
      code(() =>
        priceOrder(
          input({
            subOrders,
            vendorCoupons: [applied(percent(100, { ...vendorScope(V1), minSpend: vnd(100_001) }))],
          }),
        ),
      ),
    ).toBe('coupon.error.min-spend-not-met');
    expect(
      code(() =>
        priceOrder(
          input({
            subOrders,
            vendorCoupons: [applied(fixed(50_000, vendorScope(V1)))],
            platformCoupons: [applied(percent(100, { minSpend: vnd(60_000) }))],
          }),
        ),
      ),
    ).toBe('coupon.error.min-spend-not-met');
    expect(
      code(() =>
        priceOrder(
          input({
            subOrders,
            platformCoupons: [applied(percent(100, { endsAt: '2026-01-02T00:00:00.000Z' }))],
          }),
        ),
      ),
    ).toBe('coupon.error.expired');
    expect(
      code(() =>
        priceOrder(
          input({ subOrders, platformCoupons: [applied(percent(100, { maxRedemptions: 1 }), 1)] }),
        ),
      ),
    ).toBe('coupon.error.usage-limit-reached');
  });

  it('FIXED larger than the base is capped; paid stays 0 never below', () => {
    const r = priceOrder(
      input({
        subOrders: [so(V1, [[30_000, 1, 1000]], 5_000)],
        vendorCoupons: [applied(fixed(100_000, vendorScope(V1)))],
        platformCoupons: [applied(fixed(100_000))],
      }),
    );
    const s = r.subOrders[0]!;
    expect(s.vendorDiscount).toEqual(vnd(30_000));
    expect(s.platformDiscount).toEqual(vnd(0)); // nothing left to discount
    expect(s.commission).toEqual(vnd(0));
    expect(s.paid).toEqual(vnd(5_000));
    expect(s.net).toEqual(vnd(5_000));
  });

  it('PERCENT 100% empties the items; PERCENT is floored', () => {
    const full = priceOrder(
      input({
        subOrders: [so(V1, [[10_000, 1, 1000]])],
        platformCoupons: [applied(percent(10_000))],
      }),
    );
    expect(full.grandTotal).toEqual(vnd(0));
    const floored = priceOrder(
      input({ subOrders: [so(V1, [[999, 1, 1000]])], platformCoupons: [applied(percent(1000))] }),
    );
    expect(floored.subOrders[0]!.platformDiscount).toEqual(vnd(99)); // 99.9 -> 99
  });

  it('two platform coupons apply sequentially on the remainder', () => {
    const r = priceOrder(
      input({
        subOrders: [so(V1, [[100_000, 1, 1000]])],
        platformCoupons: [applied(percent(5000)), applied(percent(5000))],
      }),
    );
    expect(r.subOrders[0]!.platformDiscount).toEqual(vnd(75_000));
    expect(r.redemptions.map((x) => x.discount.amount)).toEqual([50_000, 25_000]);
  });

  it('splits a platform discount with largest-remainder (no unit lost)', () => {
    const r = priceOrder(
      input({
        subOrders: [so(V1, [[1, 1, 0]]), so(V2, [[1, 1, 0]]), so(V3, [[1, 1, 0]])],
        platformCoupons: [applied(fixed(100))],
      }),
    );
    expect(r.subOrders.map((s) => s.platformDiscount.amount)).toEqual([1, 1, 1]); // capped at item base
    const r2 = priceOrder(
      input({
        subOrders: [so(V1, [[1_000, 1, 0]]), so(V2, [[1_000, 1, 0]]), so(V3, [[1_000, 1, 0]])],
        platformCoupons: [applied(fixed(100))],
      }),
    );
    expect(r2.subOrders.map((s) => s.platformDiscount.amount)).toEqual([34, 33, 33]);
  });

  it('commission uses half-even, per line, after pro-rata vendor discount', () => {
    // 25 * 10% = 2.5 -> 2 (even); 35 * 10% = 3.5 -> 4 (even); lines are rounded separately
    const r = priceOrder(
      input({
        subOrders: [
          so(V1, [
            [25, 1, 1000],
            [35, 1, 1000],
          ]),
        ],
      }),
    );
    expect(r.subOrders[0]!.commission).toEqual(vnd(6));
    // vendor discount 10 over lines 25/35 -> 4/6 (4.17, 5.83): bases 21 and 29
    const d = priceOrder(
      input({
        subOrders: [
          so(V1, [
            [25, 1, 1000],
            [35, 1, 1000],
          ]),
        ],
        vendorCoupons: [applied(fixed(10, vendorScope(V1)))],
      }),
    );
    expect(d.subOrders[0]!.commission).toEqual(vnd(2 + 3)); // 2.1 -> 2, 2.9 -> 3
  });

  it('commission override per line', () => {
    const r = priceOrder(
      input({
        subOrders: [
          so(V1, [
            [100_000, 1, 300],
            [100_000, 1, 1500],
          ]),
        ],
      }),
    );
    expect(r.subOrders[0]!.commission).toEqual(vnd(3_000 + 15_000));
  });

  it('throws on currency mismatch and bad quantities', () => {
    const bad = {
      vendorId: V1,
      lines: [{ unitPrice: of(100, 'USD'), qty: 1, commissionBps: 0 }],
      shipping: vnd(0),
    };
    expect(code(() => priceOrder(input({ subOrders: [bad] })))).toBe(
      'money.error.currency-mismatch',
    );
    expect(code(() => priceOrder(input({ subOrders: [so(V1, [[100, 0, 0]])] })))).toBe(
      'money.error.invalid-operand',
    );
    expect(code(() => priceOrder(input({ subOrders: [so(V1, [[100, 1.5, 0]])] })))).toBe(
      'money.error.invalid-operand',
    );
  });

  it('handles an order with zero-priced items', () => {
    const r = priceOrder(
      input({
        subOrders: [so(V1, [[0, 2, 1000]], 1_000)],
        vendorCoupons: [applied(percent(1000, vendorScope(V1)))],
        platformCoupons: [applied(percent(1000))],
      }),
    );
    expect(r.grandTotal).toEqual(vnd(1_000));
  });
});

describe('priceOrder hardening', () => {
  it('rejects the same coupon applied twice, in either list', () => {
    const p = percent(1000);
    const subOrders = [so(V1, [[100_000, 1, 1000]])];
    expect(
      code(() => priceOrder(input({ subOrders, platformCoupons: [applied(p), applied(p)] }))),
    ).toBe('coupon.error.stack-limit-exceeded');
    const v = percent(1000, vendorScope(V1));
    expect(
      code(() =>
        priceOrder(
          input({ subOrders, vendorCoupons: [applied(v)], platformCoupons: [applied(v)] }),
        ),
      ),
    ).toBe('coupon.error.stack-limit-exceeded');
  });
  it('fails closed on invalid dates and rejects bad structure', () => {
    const subOrders = [so(V1, [[100_000, 1, 1000]])];
    expect(
      code(() =>
        evaluateCoupon(percent(1000), {
          now: new Date('x'),
          base: vnd(1),
          totalRedemptions: 0,
          userRedemptions: 0,
        }),
      ),
    ).toBe('money.error.invalid-operand');
    expect(
      code(() => priceOrder(input({ subOrders: [so(V1, [[1, 1, 0]]), so(V1, [[1, 1, 0]])] }))),
    ).toBe('money.error.invalid-operand');
    expect(code(() => priceOrder(input({ subOrders: [so(V1, [[1, 1, 0]], -1)] })))).toBe(
      'money.error.invalid-operand',
    );
    expect(
      code(() =>
        priceOrder(
          input({ subOrders, maxCouponStack: 0, platformCoupons: [applied(percent(100))] }),
        ),
      ),
    ).toBe('coupon.error.stack-limit-exceeded');
  });
  it('platform coupon after a 100% vendor discount, and a zero-base sub-order', () => {
    const r = priceOrder(
      input({
        subOrders: [so(V1, [[10_000, 1, 1000]]), so(V2, [[20_000, 1, 1000]])],
        vendorCoupons: [applied(percent(10_000, vendorScope(V1)))],
        platformCoupons: [applied(percent(5000))],
      }),
    );
    expect(r.subOrders[0]!.platformDiscount).toEqual(vnd(0));
    expect(r.subOrders[1]!.platformDiscount).toEqual(vnd(10_000));
    const all = priceOrder(
      input({
        subOrders: [so(V1, [[10_000, 1, 1000]])],
        vendorCoupons: [applied(percent(10_000, vendorScope(V1)))],
        platformCoupons: [applied(fixed(5_000))],
      }),
    );
    expect(all.grandTotal).toEqual(vnd(0));
  });
});

describe('computePayoutPostings', () => {
  it('matches D7 and sums to zero, revenue may be negative', () => {
    const r = priceOrder(
      input({
        subOrders: [so(V1, [[100_000, 1, 100]])],
        platformCoupons: [applied(fixed(50_000))],
      }),
    );
    const [escrow, wallet, revenue] = computePayoutPostings(r.subOrders[0]!);
    expect(escrow).toEqual({ account: 'PLATFORM_ESCROW', amount: vnd(-50_000) });
    expect(wallet).toEqual({ account: 'VENDOR_WALLET', amount: vnd(99_000) });
    expect(revenue).toEqual({ account: 'PLATFORM_REVENUE', amount: vnd(1_000 - 50_000) });
  });
  it('rejects inconsistent input', () => {
    expect(
      code(() =>
        computePayoutPostings({
          paid: vnd(100),
          net: vnd(90),
          commission: vnd(5),
          platformDiscount: vnd(0),
        }),
      ),
    ).toBe('money.error.invalid-operand');
  });
});

// Deterministic PRNG (mulberry32) so property loops are reproducible.
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('priceOrder properties (seeded random)', () => {
  it('holds all invariants over 3000 random orders', () => {
    const rand = rng(20261123);
    const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
    const vendors = [V1, V2, V3];
    for (let iter = 0; iter < 3000; iter++) {
      const n = int(1, 3);
      const subOrders = vendors.slice(0, n).map((v) =>
        so(
          v,
          Array.from({ length: int(1, 4) }, (): [number, number, number] => [
            int(0, 500_000),
            int(1, 5),
            int(0, 10_000),
          ]),
          int(0, 80_000),
        ),
      );
      const vendorCoupons = vendors
        .slice(0, n)
        .filter(() => rand() < 0.5)
        .map((v) =>
          applied(
            rand() < 0.5
              ? percent(int(1, 10_000), vendorScope(v))
              : fixed(int(1, 900_000), vendorScope(v)),
          ),
        );
      const platformCoupons = Array.from({ length: int(0, 2) }, () =>
        applied(rand() < 0.5 ? percent(int(1, 10_000)) : fixed(int(1, 1_500_000))),
      );
      const r = priceOrder(
        input({ subOrders, vendorCoupons, platformCoupons, maxCouponStack: 10 }),
      );

      let paidSum = 0;
      for (const s of r.subOrders) {
        const gross = s.subtotal.amount + s.shipping.amount;
        expect(s.paid.amount).toBe(gross - s.vendorDiscount.amount - s.platformDiscount.amount);
        expect(s.paid.amount).toBeGreaterThanOrEqual(s.shipping.amount); // discounts never eat shipping
        expect(s.net.amount).toBe(gross - s.vendorDiscount.amount - s.commission.amount);
        expect(s.net.amount).toBeGreaterThanOrEqual(0);
        expect(s.vendorDiscount.amount + s.platformDiscount.amount).toBeLessThanOrEqual(
          s.subtotal.amount,
        );
        expect(s.paid.amount).toBe(s.net.amount + s.commission.amount - s.platformDiscount.amount);
        const postings = computePayoutPostings(s);
        expect(postings.reduce((acc, p) => acc + p.amount.amount, 0)).toBe(0);
        paidSum += s.paid.amount;
      }
      expect(r.grandTotal.amount).toBe(paidSum);
      expect(r.grandTotal.amount).toBe(
        r.itemsTotal.amount + r.shippingTotal.amount - r.discountTotal.amount,
      );
      const redeemed = r.redemptions.reduce((acc, x) => acc + x.discount.amount, 0);
      expect(redeemed).toBe(r.discountTotal.amount);
      expect(equals(r.grandTotal, vnd(paidSum))).toBe(true);
    }
  });
});
