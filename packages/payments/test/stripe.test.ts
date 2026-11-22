import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import type { RefundInput } from '../src';
import { createStripeProvider, type StripeConfig } from '../src/stripe';
import { asyncCodeOf, codeOf, jsonResponse } from './helpers';

const WEBHOOK_SECRET = 'whsec_test_secret';
const PAYMENT_ID = '01JD0000000000000000000000';
const NOW = new Date('2026-11-23T03:00:00Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

type FetchFn = typeof fetch;

/** A real Stripe client whose HTTP goes to `fetchImpl` — nothing reaches the network. */
function setup(fetchImpl: FetchFn, overrides: Partial<StripeConfig> = {}) {
  const fetchMock = vi.fn<FetchFn>(fetchImpl);
  const client = new Stripe('sk_test_123', {
    httpClient: Stripe.createFetchHttpClient(fetchMock),
    maxNetworkRetries: 0,
  });
  const provider = createStripeProvider({
    secretKey: 'sk_test_123',
    webhookSecret: WEBHOOK_SECRET,
    client,
    now: () => NOW,
    ...overrides,
  });
  return { provider, client, fetchMock };
}

const notCalled: FetchFn = () => Promise.reject(new Error('unexpected HTTP call'));

/** Form body + headers of the n-th request the Stripe client sent. */
function sent(fetchMock: ReturnType<typeof vi.fn<FetchFn>>, n = 0) {
  const init = fetchMock.mock.calls[n]?.[1];
  const headers = new Headers(init?.headers);
  return {
    body: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    idempotencyKey: headers.get('idempotency-key'),
  };
}

const sessionInput = {
  paymentId: PAYMENT_ID,
  orderId: '01JD00000000000000000000AA',
  amount: { amount: 150_000, currency: 'VND' as const },
  returnUrl: 'https://shop.example/vi/order/success?orderId=01JD00000000000000000000AA',
  ipAddr: '203.0.113.7',
  locale: 'VI' as const,
  description: 'Order 01JD00000000000000000000AA',
};

function checkoutSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_1',
    object: 'checkout.session',
    url: 'https://checkout.stripe.com/c/pay/cs_test_1',
    expires_at: NOW_S + 30 * 60,
    client_reference_id: PAYMENT_ID,
    metadata: { paymentId: PAYMENT_ID, orderId: sessionInput.orderId },
    payment_intent: 'pi_test_1',
    payment_status: 'paid',
    amount_total: 150_000,
    currency: 'vnd',
    ...overrides,
  };
}

describe('Stripe createSession', () => {
  it('creates a payment-mode Checkout Session, passing VND (zero-decimal) through as-is', async () => {
    const { provider, fetchMock } = setup(() => Promise.resolve(jsonResponse(checkoutSession())));
    const result = await provider.createSession(sessionInput);

    expect(result).toEqual({
      redirectUrl: 'https://checkout.stripe.com/c/pay/cs_test_1',
      providerRef: 'cs_test_1',
      expiresAt: new Date((NOW_S + 30 * 60) * 1000),
    });
    const target = fetchMock.mock.calls[0]?.[0];
    const targetUrl =
      typeof target === 'string' ? target : target instanceof URL ? target.href : target?.url;
    expect(targetUrl).toBe('https://api.stripe.com/v1/checkout/sessions');
    const { body, idempotencyKey } = sent(fetchMock);
    expect(idempotencyKey).toBe(`checkout-session:${PAYMENT_ID}`);
    expect(body.get('mode')).toBe('payment');
    expect(body.get('client_reference_id')).toBe(PAYMENT_ID);
    expect(body.get('metadata[paymentId]')).toBe(PAYMENT_ID);
    expect(body.get('payment_intent_data[metadata][paymentId]')).toBe(PAYMENT_ID);
    expect(body.get('line_items[0][price_data][currency]')).toBe('vnd');
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('150000');
    expect(body.get('line_items[0][quantity]')).toBe('1');
    expect(body.get('success_url')).toBe(sessionInput.returnUrl);
    expect(body.get('locale')).toBe('vi');
    expect(body.get('expires_at')).toBe(String(NOW_S + 30 * 60));
  });

  it('passes USD cents through unchanged', async () => {
    const { provider, fetchMock } = setup(() =>
      Promise.resolve(jsonResponse(checkoutSession({ currency: 'usd', amount_total: 1999 }))),
    );
    await provider.createSession({
      ...sessionInput,
      amount: { amount: 1999, currency: 'USD' },
      locale: 'EN',
    });
    const { body } = sent(fetchMock);
    expect(body.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('1999');
    expect(body.get('locale')).toBe('en');
  });

  it('rejects a currency the adapter is not configured for, without calling Stripe', async () => {
    const { provider, fetchMock } = setup(notCalled, { currencies: ['USD'] });
    expect(await asyncCodeOf(provider.createSession(sessionInput))).toBe(
      'money.error.currency-mismatch',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps Stripe API / network errors to payment.error.provider-unavailable', async () => {
    const serverError = setup(() =>
      Promise.resolve(jsonResponse({ error: { type: 'api_error', message: 'boom' } }, 500)),
    );
    expect(await asyncCodeOf(serverError.provider.createSession(sessionInput))).toBe(
      'payment.error.provider-unavailable',
    );
    const offline = setup(() => Promise.reject(new TypeError('fetch failed')));
    expect(await asyncCodeOf(offline.provider.createSession(sessionInput))).toBe(
      'payment.error.provider-unavailable',
    );
  });
});

describe('Stripe verifyWebhook', () => {
  const { provider, client } = setup(notCalled);

  function signed(event: Record<string, unknown>, secret = WEBHOOK_SECRET) {
    const payload = JSON.stringify({ id: 'evt_1', object: 'event', ...event });
    const header = client.webhooks.generateTestHeaderString({ payload, secret });
    return { headers: { 'stripe-signature': header }, rawBody: payload, query: {} };
  }

  const completed = (session: Record<string, unknown> = {}) =>
    signed({ type: 'checkout.session.completed', data: { object: checkoutSession(session) } });

  it('maps checkout.session.completed (paid) to CONFIRMED with the Money it reports', () => {
    expect(provider.verifyWebhook(completed())).toMatchObject({
      status: 'CONFIRMED',
      paymentId: PAYMENT_ID,
      providerTxnId: 'pi_test_1',
      amount: { amount: 150_000, currency: 'VND' },
    });
  });

  it('accepts the raw body as bytes', () => {
    const req = completed({ currency: 'usd', amount_total: 1999 });
    const bytes = { ...req, rawBody: Buffer.from(req.rawBody, 'utf8') };
    expect(provider.verifyWebhook(bytes)).toMatchObject({
      status: 'CONFIRMED',
      amount: { amount: 1999, currency: 'USD' },
    });
  });

  it('throws payment.error.signature-invalid on a wrong secret, tampered body or missing header', () => {
    expect(codeOf(() => provider.verifyWebhook(signed({ type: 'x' }, 'whsec_other')))).toBe(
      'payment.error.signature-invalid',
    );
    const req = completed();
    const tampered = { ...req, rawBody: req.rawBody.replace('150000', '1') };
    expect(codeOf(() => provider.verifyWebhook(tampered))).toBe('payment.error.signature-invalid');
    expect(codeOf(() => provider.verifyWebhook({ ...req, headers: {} }))).toBe(
      'payment.error.signature-invalid',
    );
  });

  it('ignores a completed session that is not paid yet (delayed payment methods)', () => {
    expect(provider.verifyWebhook(completed({ payment_status: 'unpaid' })).status).toBe('IGNORED');
  });

  it('maps checkout.session.expired to FAILED', () => {
    const req = signed({
      type: 'checkout.session.expired',
      data: { object: checkoutSession({ payment_status: 'unpaid', payment_intent: null }) },
    });
    expect(provider.verifyWebhook(req)).toMatchObject({
      status: 'FAILED',
      paymentId: PAYMENT_ID,
      providerTxnId: 'cs_test_1',
    });
  });

  it('maps payment_intent.payment_failed to FAILED via the intent metadata', () => {
    const req = signed({
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_test_2',
          object: 'payment_intent',
          amount: 1999,
          currency: 'usd',
          metadata: { paymentId: PAYMENT_ID },
        },
      },
    });
    expect(provider.verifyWebhook(req)).toMatchObject({
      status: 'FAILED',
      paymentId: PAYMENT_ID,
      providerTxnId: 'pi_test_2',
      amount: { amount: 1999, currency: 'USD' },
    });
  });

  it('ignores other event types and sessions that are not ours', () => {
    expect(
      provider.verifyWebhook(signed({ type: 'charge.refunded', data: { object: {} } })),
    ).toMatchObject({ status: 'IGNORED', eventType: 'charge.refunded' });
    expect(
      provider.verifyWebhook(completed({ client_reference_id: null, metadata: {} })).status,
    ).toBe('IGNORED');
  });

  it('rejects an amount in a currency we do not know', () => {
    expect(
      codeOf(() => provider.verifyWebhook(completed({ currency: 'eur', amount_total: 100 }))),
    ).toBe('payment.error.amount-mismatch');
  });
});

describe('Stripe refund', () => {
  const refundInput: RefundInput = {
    refundId: '01JD0000000000000000000099',
    paymentId: PAYMENT_ID,
    providerTxnId: 'pi_test_1',
    providerRef: 'cs_test_1',
    amount: { amount: 50_000, currency: 'VND' },
    paymentAmount: { amount: 150_000, currency: 'VND' },
    reason: 'Customer changed their mind',
    initiatedBy: 'admin-01',
  };
  const refundObject = (status: string) => ({
    id: 're_test_1',
    object: 'refund',
    amount: 50_000,
    currency: 'vnd',
    status,
  });

  it('refunds the PaymentIntent idempotently and maps succeeded → SUCCEEDED', async () => {
    const { provider, fetchMock } = setup(() =>
      Promise.resolve(jsonResponse(refundObject('succeeded'))),
    );
    expect(await provider.refund(refundInput)).toMatchObject({
      providerRefundId: 're_test_1',
      status: 'SUCCEEDED',
      failureCode: null,
    });
    const { body, idempotencyKey } = sent(fetchMock);
    expect(idempotencyKey).toBe('refund:01JD0000000000000000000099');
    expect(body.get('payment_intent')).toBe('pi_test_1');
    expect(body.get('amount')).toBe('50000');
    expect(body.get('metadata[refundId]')).toBe(refundInput.refundId);
  });

  it('maps pending → PENDING', async () => {
    const { provider } = setup(() => Promise.resolve(jsonResponse(refundObject('pending'))));
    expect((await provider.refund(refundInput)).status).toBe('PENDING');
  });

  it('maps a 4xx refusal to FAILED and a 5xx to provider-unavailable', async () => {
    const refused = setup(() =>
      Promise.resolve(
        jsonResponse(
          {
            error: {
              type: 'invalid_request_error',
              code: 'charge_already_refunded',
              message: 'already refunded',
            },
          },
          400,
        ),
      ),
    );
    expect(await refused.provider.refund(refundInput)).toMatchObject({
      status: 'FAILED',
      failureCode: 'charge_already_refunded',
      providerRefundId: null,
    });
    const down = setup(() =>
      Promise.resolve(jsonResponse({ error: { type: 'api_error', message: 'boom' } }, 502)),
    );
    expect(await asyncCodeOf(down.provider.refund(refundInput))).toBe(
      'payment.error.provider-unavailable',
    );
  });

  it('refuses to refund more than was paid', async () => {
    const { provider, fetchMock } = setup(notCalled);
    expect(
      await asyncCodeOf(
        provider.refund({ ...refundInput, amount: { amount: 150_001, currency: 'VND' } }),
      ),
    ).toBe('payment.error.amount-mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
