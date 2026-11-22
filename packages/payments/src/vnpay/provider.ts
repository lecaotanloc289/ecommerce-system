import { DomainError, type Currency, type Locale, type Money } from '@repo/core';
import { assertCurrency, assertPositiveAmount, single } from '../internal';
import type {
  CreateSessionInput,
  CreateSessionResult,
  FetchLike,
  PaymentProvider,
  RefundInput,
  RefundResult,
  WebhookPaymentResult,
  WebhookRequest,
} from '../types';
import {
  buildSignData,
  formatVnpDate,
  hmacSha512,
  safeEqualHex,
  sanitizeOrderInfo,
} from './signature';

export interface VnpayConfig {
  /** Merchant terminal code (`vnp_TmnCode`). Env: `VNPAY_TMN_CODE`. */
  tmnCode: string;
  /** HMAC-SHA512 secret. Env: `VNPAY_HASH_SECRET`. */
  hashSecret: string;
  /** Payment page, e.g. `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html`. Env: `VNPAY_PAY_URL`. */
  payUrl: string;
  /** Merchant web API, e.g. `https://sandbox.vnpayment.vn/merchant_webapi/api/transaction`. Env: `VNPAY_API_URL`. */
  apiUrl: string;
  /** Minutes before `vnp_ExpireDate`. Default 15 (VNPay's samples). */
  sessionTtlMinutes?: number;
  /** `vnp_OrderType` category code. Default `other`. */
  orderType?: string;
  /** IP of the server calling the refund API (`vnp_IpAddr`). Default `127.0.0.1`. */
  serverIpAddr?: string;
  /** Injected HTTP client (refund API). Default: global `fetch`. */
  fetch?: FetchLike;
  /** Injected clock. Default: `() => new Date()`. */
  now?: () => Date;
}

const VERSION = '2.1.0';
const CURRENCIES: readonly Currency[] = ['VND'];
const DEFAULT_TTL_MINUTES = 15;
/** `vnp_Amount` is Numeric[1,12] (amount × 100). */
const MAX_VNP_AMOUNT = 999_999_999_999n;

const LOCALE: Record<Locale, string> = { VI: 'vn', EN: 'en' };

/** JSON body VNPay expects in reply to an IPN call. `00` and `02` stop VNPay's retries; the rest retry. */
export interface VnpayIpnResponse {
  RspCode: string;
  Message: string;
}

/** Canonical IPN replies (VNPay reference implementation wording). */
export const VNPAY_IPN_RESPONSE = {
  success: { RspCode: '00', Message: 'Confirm Success' },
  orderNotFound: { RspCode: '01', Message: 'Order not found' },
  alreadyConfirmed: { RspCode: '02', Message: 'Order already confirmed' },
  invalidAmount: { RspCode: '04', Message: 'invalid amount' },
  invalidSignature: { RspCode: '97', Message: 'Invalid signature' },
  unknownError: { RspCode: '99', Message: 'Unknow error' },
} as const satisfies Record<string, VnpayIpnResponse>;

function toVnpAmount(money: Money): string {
  const scaled = BigInt(money.amount) * 100n;
  if (scaled > MAX_VNP_AMOUNT) {
    throw new DomainError('money.error.overflow', { currency: money.currency });
  }
  return scaled.toString();
}

function fromVnpAmount(raw: string | undefined): Money {
  // `vnp_Amount` = minor units × 100, digits only. Anything else cannot be trusted as an amount.
  if (raw === undefined || !/^\d{1,15}$/.test(raw)) {
    throw new DomainError('payment.error.amount-mismatch', {
      provider: 'VNPAY',
      received: raw ?? '',
    });
  }
  const value = BigInt(raw);
  if (value % 100n !== 0n) {
    throw new DomainError('payment.error.amount-mismatch', { provider: 'VNPAY', received: raw });
  }
  return { amount: Number(value / 100n), currency: 'VND' };
}

function unavailable(reason: string, extra: Record<string, string | number> = {}): DomainError {
  return new DomainError('payment.error.provider-unavailable', {
    provider: 'VNPAY',
    reason,
    ...extra,
  });
}

function invalidSignature(reason: string): DomainError {
  return new DomainError('payment.error.signature-invalid', { provider: 'VNPAY', reason });
}

/** Refund API response, after the fields we read are checked to be strings. */
type VnpayRefundResponse = Record<string, string>;

function parseRefundResponse(body: unknown): VnpayRefundResponse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw unavailable('malformed-response');
  }
  const out: VnpayRefundResponse = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number') out[key] = String(value);
  }
  return out;
}

/**
 * Refund request checksum (VNPay merchant webapi, `vnp_Command=refund`): HMAC-SHA512 over the
 * fields joined with `|` in exactly this order — NOT the sorted query-string format of the pay URL.
 */
export const REFUND_REQUEST_HASH_FIELDS = [
  'vnp_RequestId',
  'vnp_Version',
  'vnp_Command',
  'vnp_TmnCode',
  'vnp_TransactionType',
  'vnp_TxnRef',
  'vnp_Amount',
  'vnp_TransactionNo',
  'vnp_TransactionDate',
  'vnp_CreateBy',
  'vnp_CreateDate',
  'vnp_IpAddr',
  'vnp_OrderInfo',
] as const;

/** Refund response checksum field order (same `|` format). */
export const REFUND_RESPONSE_HASH_FIELDS = [
  'vnp_ResponseId',
  'vnp_Command',
  'vnp_ResponseCode',
  'vnp_Message',
  'vnp_TmnCode',
  'vnp_TxnRef',
  'vnp_Amount',
  'vnp_BankCode',
  'vnp_PayDate',
  'vnp_TransactionNo',
  'vnp_TransactionType',
  'vnp_TransactionStatus',
  'vnp_OrderInfo',
] as const;

function pipeData(fields: readonly string[], values: Readonly<Record<string, string>>): string {
  return fields.map((field) => values[field] ?? '').join('|');
}

/** VNPay refund response codes that mean "refused — don't retry the same request". */
const REFUND_REFUSED = new Set(['02', '03', '91', '95', '97']);

export type VnpayProvider = PaymentProvider & { readonly id: 'VNPAY' };

export function createVnpayProvider(config: VnpayConfig): VnpayProvider {
  const ttlMinutes = config.sessionTtlMinutes ?? DEFAULT_TTL_MINUTES;
  const orderType = config.orderType ?? 'other';
  const serverIpAddr = config.serverIpAddr ?? '127.0.0.1';
  const fetchFn: FetchLike = config.fetch ?? ((input, init) => fetch(input, init));
  const now = config.now ?? (() => new Date());

  function sign(params: Readonly<Record<string, string>>): string {
    return hmacSha512(config.hashSecret, buildSignData(params));
  }

  /** Building the URL is pure and synchronous (no API call). */
  function buildSession(input: CreateSessionInput): CreateSessionResult {
    assertCurrency('VNPAY', CURRENCIES, input.amount);
    assertPositiveAmount(input.amount);
    const createdAt = now();
    const expiresAt = new Date(createdAt.getTime() + ttlMinutes * 60_000);
    const createDate = formatVnpDate(createdAt);

    const params: Record<string, string> = {
      vnp_Version: VERSION,
      vnp_Command: 'pay',
      vnp_TmnCode: config.tmnCode,
      vnp_Amount: toVnpAmount(input.amount),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: input.paymentId,
      vnp_OrderInfo: sanitizeOrderInfo(input.description, `Thanh toan ${input.paymentId}`),
      vnp_OrderType: orderType,
      vnp_Locale: LOCALE[input.locale],
      vnp_ReturnUrl: input.returnUrl,
      vnp_IpAddr: input.ipAddr,
      vnp_CreateDate: createDate,
      vnp_ExpireDate: formatVnpDate(expiresAt),
    };
    const query = buildSignData(params);
    const secureHash = hmacSha512(config.hashSecret, query);
    return {
      redirectUrl: `${config.payUrl}?${query}&vnp_SecureHash=${secureHash}`,
      providerRef: createDate,
      expiresAt,
    };
  }

  function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
    // Validation errors become rejections, like the other adapters' async failures.
    return new Promise((resolve) => resolve(buildSession(input)));
  }

  /** Verifies an IPN call or browser return (both GET with the same signed query). */
  function verifyWebhook(req: WebhookRequest): WebhookPaymentResult {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (!key.startsWith('vnp_')) continue;
      // A repeated key is either tampering or a broken proxy — never guess which value was signed.
      if (Array.isArray(value)) throw invalidSignature('duplicate-param');
      const v = single(value);
      if (v !== undefined) params[key] = v;
    }
    const received = params.vnp_SecureHash;
    if (received === undefined || received === '') throw invalidSignature('missing-hash');
    if (!safeEqualHex(sign(params), received)) throw invalidSignature('mismatch');

    const paymentId = params.vnp_TxnRef;
    if (paymentId === undefined || paymentId === '') throw invalidSignature('missing-txn-ref');
    const amount = fromVnpAmount(params.vnp_Amount);
    const confirmed = params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00';
    return {
      status: confirmed ? 'CONFIRMED' : 'FAILED',
      paymentId,
      providerTxnId: params.vnp_TransactionNo ?? '',
      amount,
      raw: params,
    };
  }

  async function refund(input: RefundInput): Promise<RefundResult> {
    assertCurrency('VNPAY', CURRENCIES, input.amount);
    assertPositiveAmount(input.amount);
    if (
      input.paymentAmount.currency !== input.amount.currency ||
      input.amount.amount > input.paymentAmount.amount
    ) {
      throw new DomainError('payment.error.amount-mismatch', {
        provider: 'VNPAY',
        refund: input.amount.amount,
        paid: input.paymentAmount.amount,
      });
    }
    if (input.providerRef === null || !/^\d{14}$/.test(input.providerRef)) {
      // vnp_TransactionDate must be the pay request's vnp_CreateDate (createSession's providerRef).
      throw new DomainError('common.error.validation-failed', {
        field: 'providerRef',
        provider: 'VNPAY',
      });
    }

    const request: Record<string, string> = {
      vnp_RequestId: input.refundId,
      vnp_Version: VERSION,
      vnp_Command: 'refund',
      vnp_TmnCode: config.tmnCode,
      vnp_TransactionType: input.amount.amount === input.paymentAmount.amount ? '02' : '03',
      vnp_TxnRef: input.paymentId,
      vnp_Amount: toVnpAmount(input.amount),
      vnp_TransactionNo: input.providerTxnId,
      vnp_TransactionDate: input.providerRef,
      vnp_CreateBy: input.initiatedBy,
      vnp_CreateDate: formatVnpDate(now()),
      vnp_IpAddr: serverIpAddr,
      vnp_OrderInfo: sanitizeOrderInfo(input.reason, `Hoan tien ${input.paymentId}`),
    };
    request.vnp_SecureHash = hmacSha512(
      config.hashSecret,
      pipeData(REFUND_REQUEST_HASH_FIELDS, request),
    );

    let response: Response;
    try {
      response = await fetchFn(config.apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
    } catch {
      throw unavailable('network');
    }
    if (!response.ok) throw unavailable('http', { status: response.status });

    let body: VnpayRefundResponse;
    try {
      body = parseRefundResponse(await response.json());
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw unavailable('malformed-response');
    }

    const code = body.vnp_ResponseCode ?? '';
    if (code === '00') {
      // VNPay accepted the refund. Success responses are signed; never act on a forged "00".
      const expected = hmacSha512(config.hashSecret, pipeData(REFUND_RESPONSE_HASH_FIELDS, body));
      if (!safeEqualHex(expected, body.vnp_SecureHash ?? '')) {
        throw invalidSignature('refund-response');
      }
      return {
        providerRefundId: body.vnp_TransactionNo || null,
        status: 'SUCCEEDED',
        failureCode: null,
        raw: body,
      };
    }
    if (code === '94') {
      // Duplicate: a refund for this request was already sent and is being processed.
      return { providerRefundId: null, status: 'PENDING', failureCode: code, raw: body };
    }
    if (REFUND_REFUSED.has(code)) {
      return { providerRefundId: null, status: 'FAILED', failureCode: code, raw: body };
    }
    // 99 (other error) or an unknown code: transient as far as we can tell — let the worker retry.
    throw unavailable('refund-error', { code });
  }

  return { id: 'VNPAY', currencies: CURRENCIES, createSession, verifyWebhook, refund };
}
