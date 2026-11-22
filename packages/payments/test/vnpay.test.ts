import { describe, expect, it, vi } from 'vitest';
import type { FetchLike, RefundInput } from '../src';
import {
  buildSignData,
  createVnpayProvider,
  formatVnpDate,
  hmacSha512,
  sanitizeOrderInfo,
  vnpEncode,
  type VnpayConfig,
} from '../src/vnpay';
import { asyncCodeOf, codeOf, jsonResponse } from './helpers';

const SECRET = 'SECRETKEYFORTESTS0123456789ABCDE';
const PAYMENT_ID = '01JD0000000000000000000000';
// 2026-11-23 10:31:11 in Vietnam (GMT+7).
const CREATED_AT = new Date('2026-11-23T03:31:11Z');

function provider(overrides: Partial<VnpayConfig> = {}) {
  return createVnpayProvider({
    tmnCode: 'DEMOV210',
    hashSecret: SECRET,
    payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    apiUrl: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
    now: () => CREATED_AT,
    ...overrides,
  });
}

const sessionInput = {
  paymentId: PAYMENT_ID,
  orderId: '01JD00000000000000000000AA',
  amount: { amount: 150_000, currency: 'VND' as const },
  returnUrl: 'https://shop.example/vi/checkout/return/vnpay',
  ipAddr: '203.0.113.7',
  locale: 'VI' as const,
  description: 'Thanh toán đơn hàng #01JABC',
};

/** An IPN query as VNPay sends it, signed with `secret`. */
function ipnQuery(overrides: Record<string, string> = {}, secret = SECRET): Record<string, string> {
  const params: Record<string, string> = {
    vnp_Amount: '15000000',
    vnp_BankCode: 'NCB',
    vnp_BankTranNo: 'VNP14226112',
    vnp_CardType: 'ATM',
    vnp_OrderInfo: 'Thanh toan don hang 01JABC',
    vnp_PayDate: '20261123103500',
    vnp_ResponseCode: '00',
    vnp_TmnCode: 'DEMOV210',
    vnp_TransactionNo: '14226112',
    vnp_TransactionStatus: '00',
    vnp_TxnRef: PAYMENT_ID,
    ...overrides,
  };
  return { ...params, vnp_SecureHash: hmacSha512(secret, buildSignData(params)) };
}

const ipn = (query: Record<string, string | string[]>) => ({ headers: {}, rawBody: '', query });

const bodyText = (init: RequestInit | undefined): string =>
  typeof init?.body === 'string' ? init.body : '';

describe('VNPay encoding primitives', () => {
  it('form-urlencodes like VNPay (doc example: "Thanh toan don hang :5")', () => {
    expect(vnpEncode('Thanh toan don hang :5')).toBe('Thanh+toan+don+hang+%3A5');
    expect(vnpEncode('https://a.b/c?d=1&e=2')).toBe('https%3A%2F%2Fa.b%2Fc%3Fd%3D1%26e%3D2');
    expect(vnpEncode("a-b_c.d*e~f!g'(h)")).toBe('a-b_c.d*e%7Ef%21g%27%28h%29');
    expect(vnpEncode('đ')).toBe('%C4%91');
  });

  it('formats dates as yyyyMMddHHmmss in GMT+7, across midnight', () => {
    expect(formatVnpDate(CREATED_AT)).toBe('20261123103111');
    expect(formatVnpDate(new Date('2026-12-31T17:30:05Z'))).toBe('20270101003005');
  });

  it('sanitizes order info to plain ASCII without special characters', () => {
    expect(sanitizeOrderInfo('Thanh toán đơn hàng #01JABC', 'x')).toBe(
      'Thanh toan don hang 01JABC',
    );
    expect(sanitizeOrderInfo('Đặt  hàng: A-1_b.c *!', 'x')).toBe('Dat hang: A-1_b.c');
    expect(sanitizeOrderInfo('###', 'fallback')).toBe('fallback');
    expect(sanitizeOrderInfo('a'.repeat(300), 'x')).toHaveLength(255);
  });

  it('signs only non-empty vnp_* params, sorted, excluding the hash fields', () => {
    expect(
      buildSignData({
        vnp_TxnRef: 'B',
        vnp_Amount: '100',
        vnp_BankCode: '',
        vnp_SecureHash: 'x',
        vnp_SecureHashType: 'HmacSHA512',
        other: 'ignored',
      }),
    ).toBe('vnp_Amount=100&vnp_TxnRef=B');
  });
});

describe('VNPay createSession', () => {
  it('builds the signed payment URL (pinned vector, HMAC computed independently with openssl)', async () => {
    const result = await provider().createSession(sessionInput);
    const signData =
      'vnp_Amount=15000000&vnp_Command=pay&vnp_CreateDate=20261123103111&vnp_CurrCode=VND' +
      '&vnp_ExpireDate=20261123104611&vnp_IpAddr=203.0.113.7&vnp_Locale=vn' +
      '&vnp_OrderInfo=Thanh+toan+don+hang+01JABC&vnp_OrderType=other' +
      '&vnp_ReturnUrl=https%3A%2F%2Fshop.example%2Fvi%2Fcheckout%2Freturn%2Fvnpay' +
      '&vnp_TmnCode=DEMOV210&vnp_TxnRef=01JD0000000000000000000000&vnp_Version=2.1.0';
    // printf '%s' "$signData" | openssl dgst -sha512 -hmac "$SECRET"
    const hash =
      '48212c11c5b987c3ccc81ce7da3da9e5aa2f7d37f1fd378f54d84b6be72f932b' +
      '441eaed570691794b96e4df7c1e628ebbea7cabf9a503de2937849238fd06648';
    expect(result.redirectUrl).toBe(
      `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?${signData}&vnp_SecureHash=${hash}`,
    );
    expect(result.providerRef).toBe('20261123103111');
    expect(result.expiresAt.toISOString()).toBe('2026-11-23T03:46:11.000Z');
  });

  it('honours the configured TTL and English locale', async () => {
    const result = await provider({ sessionTtlMinutes: 30 }).createSession({
      ...sessionInput,
      locale: 'EN',
    });
    const query = new URL(result.redirectUrl).searchParams;
    expect(query.get('vnp_Locale')).toBe('en');
    expect(query.get('vnp_ExpireDate')).toBe('20261123110111');
  });

  it('round-trips: the URL it builds verifies as authentic', async () => {
    const { redirectUrl } = await provider().createSession(sessionInput);
    const query = Object.fromEntries(new URL(redirectUrl).searchParams);
    expect(query.vnp_OrderInfo).toBe('Thanh toan don hang 01JABC');
    // No vnp_ResponseCode on the outbound URL → authentic but not a success.
    expect(provider().verifyWebhook(ipn(query))).toMatchObject({
      status: 'FAILED',
      paymentId: PAYMENT_ID,
      amount: { amount: 150_000, currency: 'VND' },
    });
  });

  it('rejects USD (VNPay is VND-only) and non-positive amounts', async () => {
    expect(
      await asyncCodeOf(
        provider().createSession({ ...sessionInput, amount: { amount: 1999, currency: 'USD' } }),
      ),
    ).toBe('money.error.currency-mismatch');
    expect(
      await asyncCodeOf(
        provider().createSession({ ...sessionInput, amount: { amount: 0, currency: 'VND' } }),
      ),
    ).toBe('money.error.invalid-operand');
  });

  it('rejects amounts that overflow vnp_Amount (12 digits)', async () => {
    expect(
      await asyncCodeOf(
        provider().createSession({
          ...sessionInput,
          amount: { amount: 10_000_000_000, currency: 'VND' },
        }),
      ),
    ).toBe('money.error.overflow');
  });
});

describe('VNPay verifyWebhook (IPN / return)', () => {
  it('confirms a signed success and converts vnp_Amount ÷ 100 back to minor units', () => {
    const result = provider().verifyWebhook(
      ipn({ ...ipnQuery(), vnp_SecureHashType: 'HmacSHA512' }),
    );
    expect(result).toMatchObject({
      status: 'CONFIRMED',
      paymentId: PAYMENT_ID,
      providerTxnId: '14226112',
      amount: { amount: 150_000, currency: 'VND' },
    });
  });

  it('accepts an upper-case hash and ignores non-vnp params', () => {
    const query = ipnQuery();
    const upper = {
      ...query,
      vnp_SecureHash: (query.vnp_SecureHash ?? '').toUpperCase(),
      foo: 'bar',
    };
    expect(provider().verifyWebhook(ipn(upper)).status).toBe('CONFIRMED');
  });

  it('rejects a tampered parameter', () => {
    const query = { ...ipnQuery(), vnp_Amount: '100' };
    expect(codeOf(() => provider().verifyWebhook(ipn(query)))).toBe(
      'payment.error.signature-invalid',
    );
  });

  it('rejects a payload signed with another secret', () => {
    const query = ipnQuery({}, 'SOME-OTHER-SECRET-0123456789ABCD');
    expect(codeOf(() => provider().verifyWebhook(ipn(query)))).toBe(
      'payment.error.signature-invalid',
    );
  });

  it('rejects a missing hash and repeated params', () => {
    const { vnp_SecureHash: _omit, ...unsigned } = ipnQuery();
    expect(codeOf(() => provider().verifyWebhook(ipn(unsigned)))).toBe(
      'payment.error.signature-invalid',
    );
    const repeated = { ...ipnQuery(), vnp_Amount: ['15000000', '100'] };
    expect(codeOf(() => provider().verifyWebhook(ipn(repeated)))).toBe(
      'payment.error.signature-invalid',
    );
  });

  it('maps a response code other than 00 to FAILED', () => {
    const cancelled = provider().verifyWebhook(
      ipn(ipnQuery({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02' })),
    );
    expect(cancelled.status).toBe('FAILED');
    const notSettled = provider().verifyWebhook(ipn(ipnQuery({ vnp_TransactionStatus: '01' })));
    expect(notSettled.status).toBe('FAILED');
  });

  it('rejects a signed vnp_Amount that is not a whole number of đồng × 100', () => {
    expect(codeOf(() => provider().verifyWebhook(ipn(ipnQuery({ vnp_Amount: '15000050' }))))).toBe(
      'payment.error.amount-mismatch',
    );
  });
});

describe('VNPay refund', () => {
  const REFUND_AT = new Date('2026-11-25T01:00:00Z'); // 08:00:00 GMT+7
  const refundInput: RefundInput = {
    refundId: '01JD0000000000000000000099',
    paymentId: PAYMENT_ID,
    providerTxnId: '14226112',
    providerRef: '20261123103111',
    amount: { amount: 50_000, currency: 'VND' },
    paymentAmount: { amount: 150_000, currency: 'VND' },
    reason: 'Khách đổi ý',
    initiatedBy: 'admin-01',
  };
  const okResponse = {
    vnp_ResponseId: 'RESP1',
    vnp_Command: 'refund',
    vnp_ResponseCode: '00',
    vnp_Message: 'Refund success',
    vnp_TmnCode: 'DEMOV210',
    vnp_TxnRef: PAYMENT_ID,
    vnp_Amount: '5000000',
    vnp_BankCode: 'NCB',
    vnp_PayDate: '20261125080100',
    vnp_TransactionNo: '14226999',
    vnp_TransactionType: '03',
    vnp_TransactionStatus: '05',
    vnp_OrderInfo: 'Khach doi y',
    // openssl over the pipe-joined REFUND_RESPONSE_HASH_FIELDS above.
    vnp_SecureHash:
      'c813f5eee768bbdda3166938779437c2fe29449238f8df24852481f62d18dc5f' +
      '47325c3be7d9d83858503b049884045d07c52046429919df0478c99bc9f95b2e',
  };

  function refundProvider(fetchImpl: FetchLike) {
    return provider({ fetch: fetchImpl, now: () => REFUND_AT, serverIpAddr: '10.0.0.5' });
  }

  it('POSTs the JSON payload with the pipe-ordered checksum and maps 00 to SUCCEEDED', async () => {
    const fetchMock = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(okResponse)));
    const result = await refundProvider(fetchMock).refund(refundInput);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://sandbox.vnpayment.vn/merchant_webapi/api/transaction');
    expect(init?.method).toBe('POST');
    const sent: unknown = JSON.parse(bodyText(init));
    expect(sent).toEqual({
      vnp_RequestId: '01JD0000000000000000000099',
      vnp_Version: '2.1.0',
      vnp_Command: 'refund',
      vnp_TmnCode: 'DEMOV210',
      vnp_TransactionType: '03',
      vnp_TxnRef: PAYMENT_ID,
      vnp_Amount: '5000000',
      vnp_TransactionNo: '14226112',
      vnp_TransactionDate: '20261123103111',
      vnp_CreateBy: 'admin-01',
      vnp_CreateDate: '20261125080000',
      vnp_IpAddr: '10.0.0.5',
      vnp_OrderInfo: 'Khach doi y',
      // printf '%s' '01JD…99|2.1.0|refund|DEMOV210|03|01JD…00|5000000|14226112|20261123103111|admin-01|20261125080000|10.0.0.5|Khach doi y' | openssl dgst -sha512 -hmac "$SECRET"
      vnp_SecureHash:
        'c244ec58887a816468d0101da5093c9f08643ce6e2a32a279e08472aa453a8cc' +
        'c10dc17d257430b8c6c592a56b48bbcc0f047a523aa5cf6c55658a7fd9ce5f26',
    });
    expect(result).toMatchObject({
      status: 'SUCCEEDED',
      providerRefundId: '14226999',
      failureCode: null,
    });
  });

  it('uses transaction type 02 for a full refund', async () => {
    const fetchMock = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(okResponse)));
    await refundProvider(fetchMock)
      .refund({ ...refundInput, amount: refundInput.paymentAmount })
      .catch(() => undefined); // response hash no longer matches the request; only the payload matters here
    const sent: unknown = JSON.parse(bodyText(fetchMock.mock.calls[0]?.[1]));
    expect(sent).toMatchObject({ vnp_TransactionType: '02', vnp_Amount: '15000000' });
  });

  it('refuses a "00" response with a forged checksum', async () => {
    const forged = { ...okResponse, vnp_Amount: '15000000' };
    const fetchMock = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(forged)));
    expect(await asyncCodeOf(refundProvider(fetchMock).refund(refundInput))).toBe(
      'payment.error.signature-invalid',
    );
  });

  it('maps refusals to FAILED and duplicates to PENDING', async () => {
    const notFound = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse({ vnp_ResponseCode: '91', vnp_Message: 'not found' })),
    );
    expect(await refundProvider(notFound).refund(refundInput)).toMatchObject({
      status: 'FAILED',
      failureCode: '91',
      providerRefundId: null,
    });
    const duplicate = vi.fn<FetchLike>(() =>
      Promise.resolve(jsonResponse({ vnp_ResponseCode: '94', vnp_Message: 'duplicate' })),
    );
    expect(await refundProvider(duplicate).refund(refundInput)).toMatchObject({
      status: 'PENDING',
      failureCode: '94',
    });
  });

  it('throws provider-unavailable on HTTP errors, network errors, code 99 and garbage', async () => {
    const cases: FetchLike[] = [
      () => Promise.resolve(jsonResponse({ error: 'down' }, 503)),
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(jsonResponse({ vnp_ResponseCode: '99' })),
      () => Promise.resolve(new Response('<html>', { status: 200 })),
      () => Promise.resolve(jsonResponse([1, 2])),
    ];
    for (const fetchImpl of cases) {
      expect(await asyncCodeOf(refundProvider(fetchImpl).refund(refundInput))).toBe(
        'payment.error.provider-unavailable',
      );
    }
  });

  it('validates the refund before calling VNPay', async () => {
    const fetchMock = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(okResponse)));
    const p = refundProvider(fetchMock);
    expect(
      await asyncCodeOf(p.refund({ ...refundInput, amount: { amount: 150_001, currency: 'VND' } })),
    ).toBe('payment.error.amount-mismatch');
    expect(await asyncCodeOf(p.refund({ ...refundInput, providerRef: null }))).toBe(
      'common.error.validation-failed',
    );
    expect(
      await asyncCodeOf(p.refund({ ...refundInput, amount: { amount: 5, currency: 'USD' } })),
    ).toBe('money.error.currency-mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
