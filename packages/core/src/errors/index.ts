import { z } from 'zod';

/**
 * Error code catalog (Golden Rule #7). The API returns `{ errorCode, params }` and the
 * frontend translates `errorCode` via @repo/i18n — codes double as i18n keys, so they
 * follow the `<domain>.error.<kebab-case>` convention. Never put user-facing text here.
 *
 * Adding a code: append it to ERROR_CODES, then give it an HTTP status in
 * ERROR_HTTP_STATUS (the Record type makes a missing status a compile error).
 */
export const ERROR_CODES = [
  // common
  'common.error.validation-failed',
  'common.error.unauthorized',
  'common.error.forbidden',
  'common.error.not-found',
  'common.error.conflict',
  'common.error.rate-limited',
  'common.error.internal',
  // idempotency (Golden Rule #3)
  'idempotency.error.key-required',
  'idempotency.error.key-reused',
  'idempotency.error.in-progress',
  // auth (Golden Rule #5)
  'auth.error.token-expired',
  'auth.error.token-invalid',
  'auth.error.refresh-revoked',
  'auth.error.oauth-failed',
  // money
  'money.error.currency-mismatch',
  'money.error.non-integer',
  'money.error.overflow',
  'money.error.invalid-operand',
  // vendor
  'vendor.error.not-active',
  'vendor.error.application-already-pending',
  'vendor.error.application-not-pending',
  // catalog
  'product.error.not-found',
  'product.error.not-available',
  'product.error.variant-not-found',
  // cart
  'cart.error.quantity-exceeds-stock',
  // checkout
  'checkout.error.empty-cart',
  'checkout.error.out-of-stock',
  'checkout.error.price-changed',
  'checkout.error.address-not-found',
  'checkout.error.shipping-method-invalid',
  'checkout.error.shipping-method-missing',
  'checkout.error.currency-mismatch',
  // coupon
  'coupon.error.not-found',
  'coupon.error.not-started',
  'coupon.error.expired',
  'coupon.error.min-spend-not-met',
  'coupon.error.usage-limit-reached',
  'coupon.error.stack-limit-exceeded',
  // order
  'order.error.not-found',
  'order.error.invalid-status-transition',
  'order.error.refund-window-expired',
  // payment
  'payment.error.provider-unavailable',
  'payment.error.signature-invalid',
  'payment.error.amount-mismatch',
  'payment.error.already-confirmed',
  // live
  'live.error.not-found',
  'live.error.invalid-transition',
  'live.error.not-provisioned',
  'live.error.encoder-offline',
  'live.error.already-live',
  'live.error.not-live',
  'live.error.product-not-owned',
  'live.error.product-inactive',
  'live.error.too-many-products',
  'live.error.chat-rate-limited',
  'live.error.chat-muted',
  'live.error.webhook-signature-invalid',
  'live.error.stream-provider-unavailable',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  'common.error.validation-failed': 422,
  'common.error.unauthorized': 401,
  'common.error.forbidden': 403,
  'common.error.not-found': 404,
  'common.error.conflict': 409,
  'common.error.rate-limited': 429,
  'common.error.internal': 500,
  'idempotency.error.key-required': 400,
  'idempotency.error.key-reused': 422,
  'idempotency.error.in-progress': 409,
  'auth.error.token-expired': 401,
  'auth.error.token-invalid': 401,
  'auth.error.refresh-revoked': 401,
  'auth.error.oauth-failed': 401,
  'money.error.currency-mismatch': 422,
  'money.error.non-integer': 422,
  'money.error.overflow': 422,
  'money.error.invalid-operand': 500,
  'vendor.error.not-active': 403,
  'vendor.error.application-already-pending': 409,
  'vendor.error.application-not-pending': 409,
  'product.error.not-found': 404,
  'product.error.not-available': 409,
  'product.error.variant-not-found': 404,
  'cart.error.quantity-exceeds-stock': 409,
  'checkout.error.empty-cart': 422,
  'checkout.error.out-of-stock': 409,
  'checkout.error.price-changed': 409,
  'checkout.error.address-not-found': 404,
  'checkout.error.shipping-method-invalid': 422,
  'checkout.error.shipping-method-missing': 422,
  'checkout.error.currency-mismatch': 422,
  'coupon.error.not-found': 404,
  'coupon.error.not-started': 422,
  'coupon.error.expired': 422,
  'coupon.error.min-spend-not-met': 422,
  'coupon.error.usage-limit-reached': 422,
  'coupon.error.stack-limit-exceeded': 422,
  'order.error.not-found': 404,
  'order.error.invalid-status-transition': 409,
  'order.error.refund-window-expired': 422,
  'payment.error.provider-unavailable': 503,
  'payment.error.signature-invalid': 400,
  'payment.error.amount-mismatch': 422,
  'payment.error.already-confirmed': 409,
  // live
  'live.error.not-found': 404,
  'live.error.invalid-transition': 409,
  'live.error.not-provisioned': 409,
  'live.error.encoder-offline': 409,
  'live.error.already-live': 409,
  'live.error.not-live': 409,
  'live.error.product-not-owned': 422,
  'live.error.product-inactive': 422,
  'live.error.too-many-products': 422,
  'live.error.chat-rate-limited': 429,
  'live.error.chat-muted': 403,
  'live.error.webhook-signature-invalid': 401,
  'live.error.stream-provider-unavailable': 503,
};

/** Interpolation values for the translated message (e.g. `{ sku, available }`). */
export const ErrorParamsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);
export type ErrorParams = z.infer<typeof ErrorParamsSchema>;

/** Body of every API error response. */
export const ErrorResponseSchema = z.object({
  errorCode: ErrorCodeSchema,
  params: ErrorParamsSchema,
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Throwable domain error. The server maps it to `ERROR_HTTP_STATUS[code]` + an
 * ErrorResponse body; `message` is for logs only and is never shown to users.
 */
export class DomainError extends Error {
  override readonly name = 'DomainError';
  readonly code: ErrorCode;
  readonly params: ErrorParams;

  constructor(code: ErrorCode, params: ErrorParams = {}) {
    super(`${code} ${JSON.stringify(params)}`);
    this.code = code;
    this.params = params;
  }

  get httpStatus(): number {
    return ERROR_HTTP_STATUS[this.code];
  }

  toResponse(): ErrorResponse {
    return { errorCode: this.code, params: this.params };
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
