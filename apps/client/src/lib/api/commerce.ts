import {
  CartMergeResultSchema,
  CartSchema,
  CartShippingOptionsSchema,
  OrderSchema,
  OrderSummaryPageSchema,
  PaymentSessionSchema,
  type Cart,
  type CartLineInput,
  type CartMergeResult,
  type CartShippingOptions,
  type CatalogLocale,
  type Checkout,
  type Order,
  type OrderSummaryPage,
  type PaymentProvider,
} from '@repo/core';
import type { PaymentSessionReply } from '../payment-session';
import { newIdempotencyKey as newUlid } from '../idempotency';
import { browserApi } from './browser';
import { parseResult } from './errors';

/**
 * Signed-in commerce calls (cart, addresses, checkout, orders) — always from the browser with
 * the in-memory access token (storefront CLAUDE.md "Data fetching"). Every reply is parsed
 * through its core schema; every non-2xx throws `ApiError`. Mutations take an optional
 * `idempotencyKey`: pass ONE fixed key per user action so a retry replays instead of repeating
 * (the generated client types require the header; a fresh key is made when none is given).
 */
const idem = (key: string = newUlid()) => ({ 'Idempotency-Key': key });

export async function fetchCart(locale: CatalogLocale): Promise<Cart> {
  return parseResult(
    await browserApi().GET('/v1/cart', { params: { query: { locale } } }),
    CartSchema,
  );
}

export async function putCartItem(
  variantId: string,
  quantity: number,
  locale: CatalogLocale,
): Promise<Cart> {
  return parseResult(
    await browserApi().PUT('/v1/cart/items/{variantId}', {
      params: { path: { variantId }, query: { locale }, header: idem() },
      body: { quantity },
    }),
    CartSchema,
  );
}

export async function deleteCartItem(variantId: string, locale: CatalogLocale): Promise<Cart> {
  return parseResult(
    await browserApi().DELETE('/v1/cart/items/{variantId}', {
      params: { path: { variantId }, query: { locale }, header: idem() },
    }),
    CartSchema,
  );
}

/** `POST /v1/cart/merge` — the same `idempotencyKey` replays; a new one adds the quantities again. */
export async function mergeCart(
  items: CartLineInput[],
  locale: CatalogLocale,
  idempotencyKey: string,
): Promise<CartMergeResult> {
  return parseResult(
    await browserApi().POST('/v1/cart/merge', {
      params: { query: { locale }, header: idem(idempotencyKey) },
      body: { items },
    }),
    CartMergeResultSchema,
  );
}

export async function fetchShippingOptions(): Promise<CartShippingOptions> {
  return parseResult(
    await browserApi().GET('/v1/cart/shipping-options'),
    CartShippingOptionsSchema,
  );
}

/** `POST /v1/orders/checkout` — one fixed `idempotencyKey` per place-order attempt. */
export async function placeOrder(body: Checkout, idempotencyKey: string): Promise<Order> {
  return parseResult(
    await browserApi().POST('/v1/orders/checkout', {
      params: {
        header: { 'idempotency-key': idempotencyKey, 'Idempotency-Key': idempotencyKey },
      },
      body,
    }),
    OrderSchema,
  );
}

export async function fetchOrder(orderId: string): Promise<Order> {
  return parseResult(
    await browserApi().GET('/v1/orders/{id}', { params: { path: { id: orderId } } }),
    OrderSchema,
  );
}

export async function fetchOrders(cursor?: string): Promise<OrderSummaryPage> {
  return parseResult(
    await browserApi().GET('/v1/orders', {
      params: { query: cursor ? { cursor } : {} },
    }),
    OrderSummaryPageSchema,
  );
}

export async function cancelOrder(orderId: string): Promise<Order> {
  return parseResult(
    await browserApi().POST('/v1/orders/{id}/cancel', {
      params: { path: { id: orderId }, header: idem() },
    }),
    OrderSchema,
  );
}

export async function confirmReceived(orderId: string, subOrderId: string): Promise<Order> {
  return parseResult(
    await browserApi().POST('/v1/orders/{orderId}/sub-orders/{id}/confirm-received', {
      params: { path: { orderId, id: subOrderId }, header: idem() },
    }),
    OrderSchema,
  );
}

/** One poll of `GET /v1/orders/:id/payment`: 202 (worker not done) and 200 share the body shape. */
export async function fetchPaymentSession(orderId: string): Promise<PaymentSessionReply> {
  const result = await browserApi().GET('/v1/orders/{id}/payment', {
    params: { path: { id: orderId } },
  });
  return {
    httpStatus: result.response.status,
    session: parseResult(result, PaymentSessionSchema),
  };
}

/** `POST /v1/orders/:id/payments` — a new payment attempt, optionally on another provider. */
export async function retryPayment(
  orderId: string,
  provider: PaymentProvider | undefined,
  idempotencyKey: string,
): Promise<void> {
  const result = await browserApi().POST('/v1/orders/{id}/payments', {
    params: { path: { id: orderId }, header: idem(idempotencyKey) },
    body: provider ? { provider } : {},
  });
  parseResult(result, PaymentSessionSchema);
}
