import { describe, expect, it } from 'vitest';
import { CartShippingOptionsSchema } from '@repo/core';
import { CartItemSnapshotSchema, type CartLineView } from '../src/lib/cart';
import {
  EMPTY_CHOICES,
  buildCheckoutBody,
  checkoutFingerprint,
  checkoutGuard,
  methodsForVendor,
  resolveProvider,
  resolveShipping,
  sanitizeChoices,
  supportedProviders,
  type CheckoutChoices,
  type GuardInput,
} from '../src/lib/checkout';
import { stepForError } from '../src/lib/checkout-errors';

const ulid = (n: number) => `01JD${String(n).padStart(22, '0')}`;
const V1 = ulid(100);
const V2 = ulid(200);

function line(n: number, vendorId: string, overrides: Partial<CartLineView> = {}): CartLineView {
  const snapshot = CartItemSnapshotSchema.parse({
    variantId: ulid(n),
    productId: ulid(n + 1000),
    vendorId,
    productName: `Product ${n}`,
    productSlug: `product-${n}`,
    attributes: {},
    imageUrl: null,
    unitPrice: { amount: 100_000, currency: 'VND' },
    stockAvailable: 5,
    vendorName: `Vendor ${vendorId.slice(-3)}`,
    vendorSlug: `vendor-${vendorId.slice(-3)}`,
  });
  return { ...snapshot, quantity: 1, unavailable: false, maxQty: 5, ...overrides };
}

const options = CartShippingOptionsSchema.parse({
  groups: [
    {
      vendorId: V1,
      methods: [
        {
          id: ulid(11),
          vendorId: V1,
          name: 'Express',
          price: { amount: 60_000, currency: 'VND' },
          estDays: 1,
          isActive: true,
        },
        {
          id: ulid(12),
          vendorId: V1,
          name: 'Standard',
          price: { amount: 25_000, currency: 'VND' },
          estDays: 4,
          isActive: true,
        },
        {
          id: ulid(13),
          vendorId: V1,
          name: 'Off',
          price: { amount: 0, currency: 'VND' },
          estDays: 2,
          isActive: false,
        },
      ],
    },
    {
      vendorId: V2,
      methods: [
        {
          id: ulid(21),
          vendorId: V2,
          name: 'Only',
          price: { amount: 30_000, currency: 'VND' },
          estDays: 3,
          isActive: true,
        },
      ],
    },
  ],
});

const twoVendorLines = [line(1, V1), line(2, V2)];

const complete: CheckoutChoices = {
  addressId: ulid(900),
  shipping: { [V1]: ulid(12), [V2]: ulid(21) },
  provider: 'VNPAY',
  couponCodes: [],
};

const base = (over: Partial<GuardInput> = {}): GuardInput => ({
  authenticated: true,
  lines: twoVendorLines,
  hasMixedCurrency: false,
  choices: complete,
  shippingOptions: options,
  ...over,
});

describe('checkoutGuard', () => {
  it('sends guests to sign-in, whatever the step', () => {
    for (const step of ['info', 'shipping', 'review'] as const) {
      expect(checkoutGuard(step, base({ authenticated: false }))).toBe('sign-in');
    }
  });

  it('sends an empty, all-unavailable or mixed-currency cart back to the cart', () => {
    expect(checkoutGuard('info', base({ lines: [] }))).toBe('cart');
    expect(checkoutGuard('info', base({ lines: [line(1, V1, { unavailable: true })] }))).toBe(
      'cart',
    );
    expect(checkoutGuard('shipping', base({ hasMixedCurrency: true }))).toBe('cart');
  });

  it('needs an address before shipping and review', () => {
    const noAddress = { ...complete, addressId: null };
    expect(checkoutGuard('info', base({ choices: noAddress }))).toBeNull();
    expect(checkoutGuard('shipping', base({ choices: noAddress }))).toBe('info');
    expect(checkoutGuard('review', base({ choices: noAddress }))).toBe('info');
  });

  it('review needs one shipping method per vendor, still offered, and a supported provider', () => {
    expect(checkoutGuard('review', base())).toBeNull();
    expect(
      checkoutGuard('review', base({ choices: { ...complete, shipping: { [V1]: ulid(12) } } })),
    ).toBe('shipping');
    // inactive / unknown method → stale pick
    expect(
      checkoutGuard(
        'review',
        base({ choices: { ...complete, shipping: { [V1]: ulid(13), [V2]: ulid(21) } } }),
      ),
    ).toBe('shipping');
    expect(checkoutGuard('review', base({ choices: { ...complete, provider: null } }))).toBe(
      'shipping',
    );
    const usd = [
      line(1, V1, { unitPrice: { amount: 1000, currency: 'USD' } }),
      line(2, V2, { unitPrice: { amount: 1000, currency: 'USD' } }),
    ];
    // VNPay can't charge USD
    expect(checkoutGuard('review', base({ lines: usd, shippingOptions: null }))).toBe('shipping');
  });
});

describe('providers', () => {
  it('VNPay is VND-only, Stripe takes both', () => {
    expect(supportedProviders('VND')).toEqual(['VNPAY', 'STRIPE']);
    expect(supportedProviders('USD')).toEqual(['STRIPE']);
    expect(resolveProvider('VNPAY', 'USD')).toBe('STRIPE');
    expect(resolveProvider('STRIPE', 'VND')).toBe('STRIPE');
    expect(resolveProvider(null, null)).toBeNull();
  });
});

describe('shipping resolution', () => {
  it('lists active methods cheapest first and preselects the cheapest', () => {
    expect(methodsForVendor(options, V1, 'VND').map((m) => m.name)).toEqual([
      'Standard',
      'Express',
    ]);
    expect(resolveShipping({}, [V1, V2], options, 'VND')).toEqual({
      [V1]: ulid(12),
      [V2]: ulid(21),
    });
  });

  it('keeps a still-valid pick and replaces a stale one', () => {
    expect(resolveShipping({ [V1]: ulid(11) }, [V1], options, 'VND')).toEqual({ [V1]: ulid(11) });
    expect(resolveShipping({ [V1]: ulid(99) }, [V1], options, 'VND')).toEqual({ [V1]: ulid(12) });
  });
});

describe('checkout body + idempotency fingerprint', () => {
  it('builds the body from payable lines and one method per vendor', () => {
    const body = buildCheckoutBody([...twoVendorLines, line(3, V1, { unavailable: true })], {
      ...complete,
      couponCodes: ['SAVE10'],
    });
    expect(body).toMatchObject({
      items: [
        { variantId: ulid(1), quantity: 1 },
        { variantId: ulid(2), quantity: 1 },
      ],
      shippingMethodIds: [ulid(12), ulid(21)],
      couponCodes: ['SAVE10'],
      provider: 'VNPAY',
    });
  });

  it('is null while a vendor has no method or the address is missing', () => {
    expect(
      buildCheckoutBody(twoVendorLines, { ...complete, shipping: { [V1]: ulid(12) } }),
    ).toBeNull();
    expect(buildCheckoutBody(twoVendorLines, { ...complete, addressId: null })).toBeNull();
  });

  it('fingerprint is stable for the same request and changes with the body', () => {
    const a = buildCheckoutBody(twoVendorLines, complete);
    const b = buildCheckoutBody([...twoVendorLines].reverse(), complete);
    const c = buildCheckoutBody(twoVendorLines, { ...complete, couponCodes: ['X1'] });
    if (!a || !b || !c) throw new Error('bodies');
    expect(checkoutFingerprint(a)).toBe(checkoutFingerprint(b));
    expect(checkoutFingerprint(a)).not.toBe(checkoutFingerprint(c));
  });

  it('sanitizes untrusted stored choices', () => {
    expect(sanitizeChoices('nope')).toBe(EMPTY_CHOICES);
    expect(
      sanitizeChoices({
        addressId: 5,
        shipping: { [V1]: 'm1', bad: 3 },
        provider: 'PAYPAL',
        couponCodes: ['A', 'A', 7],
      }),
    ).toEqual({ addressId: null, shipping: { [V1]: 'm1' }, provider: null, couponCodes: ['A'] });
  });
});

describe('stepForError', () => {
  it.each([
    ['checkout.error.out-of-stock', 'cart'],
    ['checkout.error.price-changed', 'cart'],
    ['checkout.error.currency-mismatch', 'cart'],
    ['product.error.not-available', 'cart'],
    ['checkout.error.address-not-found', 'info'],
    ['checkout.error.shipping-method-missing', 'shipping'],
    ['checkout.error.shipping-method-invalid', 'shipping'],
    ['payment.error.provider-currency-unsupported', 'shipping'],
    ['coupon.error.expired', 'review'],
    ['coupon.error.not-found', 'review'],
    ['coupon.error.min-spend-not-met', 'review'],
    ['common.error.internal', null],
    [null, null],
  ] as const)('%s → %s', (code, step) => {
    expect(stepForError(code)).toBe(step);
  });
});
