import {
  CheckoutSchema,
  PaymentProviderSchema,
  providerSupportsCurrency,
  type Checkout,
  type CartShippingOptions,
  type Currency,
  type Money,
  type PaymentProvider,
  type ShippingMethod,
} from '@repo/core';
import { payableLines, type CartLineView } from './cart';

export type CheckoutStepName = 'cart' | 'info' | 'shipping' | 'review';

/**
 * What the customer picked during checkout. Only ids and codes — persisted in sessionStorage
 * so the steps survive reloads; the server re-validates all of it when the order is placed.
 */
export interface CheckoutChoices {
  addressId: string | null;
  /** vendorId → shippingMethodId (one method per vendor, `GET /v1/cart/shipping-options`). */
  shipping: Record<string, string>;
  provider: PaymentProvider | null;
  couponCodes: string[];
}

export const EMPTY_CHOICES: CheckoutChoices = {
  addressId: null,
  shipping: {},
  provider: null,
  couponCodes: [],
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Stored choices are untrusted: keep only well-shaped strings. */
export function sanitizeChoices(stored: unknown): CheckoutChoices {
  if (!isRecord(stored)) return EMPTY_CHOICES;
  const shipping: Record<string, string> = {};
  if (isRecord(stored.shipping)) {
    for (const [vendorId, methodId] of Object.entries(stored.shipping)) {
      if (typeof methodId === 'string') shipping[vendorId] = methodId;
    }
  }
  const provider = PaymentProviderSchema.safeParse(stored.provider);
  const codes = Array.isArray(stored.couponCodes) ? stored.couponCodes : [];
  return {
    addressId: typeof stored.addressId === 'string' ? stored.addressId : null,
    shipping,
    provider: provider.success ? provider.data : null,
    couponCodes: [...new Set(codes.filter((c): c is string => typeof c === 'string'))],
  };
}

/** Currency of the payable lines (one order = one currency); null for an empty cart. */
export function cartCurrency(lines: readonly CartLineView[]): Currency | null {
  return payableLines(lines)[0]?.unitPrice.currency ?? null;
}

export const ALL_PROVIDERS: readonly PaymentProvider[] = PaymentProviderSchema.options;

/** Providers that can charge `currency` (VNPay is VND-only). */
export function supportedProviders(currency: Currency | null): PaymentProvider[] {
  if (!currency) return [];
  return ALL_PROVIDERS.filter((p) => providerSupportsCurrency(p, currency));
}

/** Keep the current provider while it still works for the cart currency, else the first that does. */
export function resolveProvider(
  current: PaymentProvider | null,
  currency: Currency | null,
): PaymentProvider | null {
  const supported = supportedProviders(currency);
  if (current && supported.includes(current)) return current;
  return supported[0] ?? null;
}

/** Distinct vendors of the payable lines, in cart order. */
export function vendorIdsOf(lines: readonly CartLineView[]): string[] {
  return [...new Set(payableLines(lines).map((l) => l.vendorId))];
}

/** Methods of one vendor in the cart currency, cheapest (then fastest) first. */
export function methodsForVendor(
  options: CartShippingOptions | null,
  vendorId: string,
  currency: Currency | null,
): ShippingMethod[] {
  const group = options?.groups.find((g) => g.vendorId === vendorId);
  return (group?.methods ?? [])
    .filter((m) => m.isActive && (currency === null || m.price.currency === currency))
    .sort((a, b) => a.price.amount - b.price.amount || a.estDays - b.estDays);
}

/**
 * One method per vendor: keep the customer's pick while it is still offered, else preselect the
 * cheapest. A vendor with no method simply has no entry (checkout is blocked on it).
 */
export function resolveShipping(
  current: Readonly<Record<string, string>>,
  vendorIds: readonly string[],
  options: CartShippingOptions,
  currency: Currency | null,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const vendorId of vendorIds) {
    const methods = methodsForVendor(options, vendorId, currency);
    const kept = methods.find((m) => m.id === current[vendorId]);
    const chosen = kept ?? methods[0];
    if (chosen) result[vendorId] = chosen.id;
  }
  return result;
}

/** Vendors of the cart that have no shipping method to choose from. */
export function vendorsWithoutMethods(
  vendorIds: readonly string[],
  options: CartShippingOptions,
  currency: Currency | null,
): string[] {
  return vendorIds.filter((v) => methodsForVendor(options, v, currency).length === 0);
}

/** Shipping fees of the chosen methods (an ESTIMATE shown before the order is placed). */
export function chosenShippingFees(
  choices: CheckoutChoices,
  vendorIds: readonly string[],
  options: CartShippingOptions | null,
  currency: Currency | null,
): Money[] {
  return vendorIds.flatMap((vendorId) => {
    const method = methodsForVendor(options, vendorId, currency).find(
      (m) => m.id === choices.shipping[vendorId],
    );
    return method ? [method.price] : [];
  });
}

export interface GuardInput {
  authenticated: boolean;
  lines: readonly CartLineView[];
  hasMixedCurrency: boolean;
  choices: CheckoutChoices;
  /** Loaded shipping options, when known — a stale pick is then rejected too. */
  shippingOptions: CartShippingOptions | null;
}

export type GuardResult = CheckoutStepName | 'sign-in' | null;

/**
 * Which page a visitor of `step` must be sent to instead (null = they may stay):
 * checkout needs a session, a non-empty single-currency cart, then an address, then one shipping
 * method per vendor plus a provider that supports the currency.
 */
export function checkoutGuard(
  step: Exclude<CheckoutStepName, 'cart'>,
  input: GuardInput,
): GuardResult {
  if (!input.authenticated) return 'sign-in';
  const vendorIds = vendorIdsOf(input.lines);
  if (vendorIds.length === 0 || input.hasMixedCurrency) return 'cart';
  if (step === 'info') return null;
  if (!input.choices.addressId) return 'info';
  if (step === 'shipping') return null;
  const currency = cartCurrency(input.lines);
  const everyVendorHasMethod = vendorIds.every((vendorId) => {
    const chosen = input.choices.shipping[vendorId];
    if (!chosen) return false;
    return input.shippingOptions
      ? methodsForVendor(input.shippingOptions, vendorId, currency).some((m) => m.id === chosen)
      : true;
  });
  if (!everyVendorHasMethod) return 'shipping';
  const { provider } = input.choices;
  if (!provider || !currency || !providerSupportsCurrency(provider, currency)) return 'shipping';
  return null;
}

/** The `POST /v1/orders/checkout` body, or null when the choices are incomplete / invalid. */
export function buildCheckoutBody(
  lines: readonly CartLineView[],
  choices: CheckoutChoices,
): Checkout | null {
  const vendorIds = vendorIdsOf(lines);
  const shippingMethodIds = vendorIds.flatMap((v) => {
    const id = choices.shipping[v];
    return id ? [id] : [];
  });
  if (shippingMethodIds.length !== vendorIds.length) return null;
  const parsed = CheckoutSchema.safeParse({
    items: payableLines(lines).map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    addressId: choices.addressId,
    shippingMethodIds,
    couponCodes: choices.couponCodes,
    provider: choices.provider,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Identity of a checkout request: the place-order `Idempotency-Key` is reused for the same
 * fingerprint (double-click, retry) and replaced when the body changes — the server answers a
 * key reused with a different body with `idempotency.error.key-reused`.
 */
export function checkoutFingerprint(body: Checkout): string {
  return JSON.stringify({
    items: [...body.items].sort((a, b) => a.variantId.localeCompare(b.variantId)),
    addressId: body.addressId,
    shippingMethodIds: [...body.shippingMethodIds].sort(),
    couponCodes: [...body.couponCodes].sort(),
    provider: body.provider,
  });
}
