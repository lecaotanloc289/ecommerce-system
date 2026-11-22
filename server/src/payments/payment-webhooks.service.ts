import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError, type PaymentProvider as PaymentProviderId } from '@repo/core';
import type { Prisma } from '@repo/db';
import {
  VNPAY_IPN_RESPONSE,
  type VnpayIpnResponse,
  type WebhookPaymentResult,
  type WebhookRequest,
} from '@repo/payments';
import { z } from 'zod';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import {
  type ConfirmationOutcome,
  PaymentConfirmationService,
} from './payment-confirmation.service';
import { PAYMENT_PROVIDERS, type PaymentProviders, requireProvider } from './payment-providers';

export type QueryRecord = Readonly<Record<string, string | string[] | undefined>>;

/** Storefront page for a payment that failed / could not be verified (built by the web app). */
export const PAYMENT_FAILED_PATH = 'order/payment-failed';
export const PAYMENT_SUCCESS_PATH = 'order/success';

// Minimal extracts of provider payloads for `Payment.rawPayload` (Zod strips every other key):
// Stripe events carry customer email/name/address; VNPay's `vnp_OrderInfo` is free text.
const VnpayRawSchema = z.object({
  vnp_TxnRef: z.string().optional(),
  vnp_Amount: z.string().optional(),
  vnp_ResponseCode: z.string().optional(),
  vnp_TransactionStatus: z.string().optional(),
  vnp_TransactionNo: z.string().optional(),
  vnp_BankCode: z.string().optional(),
  vnp_CardType: z.string().optional(),
  vnp_PayDate: z.string().optional(),
});
const StripeRawSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.number(),
  data: z.object({
    object: z.object({
      id: z.string(),
      payment_status: z.string().nullish(),
      amount_total: z.number().nullish(),
      currency: z.string().nullish(),
    }),
  }),
});

/** PII-free subset of a verified provider payload, or null when it has an unexpected shape. */
export function minimalRawPayload(
  provider: PaymentProviderId,
  raw: unknown,
): Prisma.InputJsonObject | null {
  const parsed = (provider === 'VNPAY' ? VnpayRawSchema : StripeRawSchema).safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const VNPAY_IPN_REPLY: Record<ConfirmationOutcome, VnpayIpnResponse> = {
  confirmed: VNPAY_IPN_RESPONSE.success,
  failed: VNPAY_IPN_RESPONSE.success,
  'refund-requested': VNPAY_IPN_RESPONSE.success,
  'manual-review': VNPAY_IPN_RESPONSE.success,
  'already-processed': VNPAY_IPN_RESPONSE.alreadyConfirmed,
  'not-found': VNPAY_IPN_RESPONSE.orderNotFound,
  'amount-mismatch': VNPAY_IPN_RESPONSE.invalidAmount,
};

/**
 * Provider callbacks: verify (`@repo/payments`, no I/O) → `PaymentConfirmationService`.
 * Nothing is read or written before the signature is verified. Payloads are never logged.
 */
@Injectable()
export class PaymentWebhooksService {
  private readonly logger = new Logger(PaymentWebhooksService.name);

  constructor(
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProviders,
    @Inject(ENV) private readonly env: Env,
    private readonly confirmation: PaymentConfirmationService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Stripe: 503 when not configured, 400 `payment.error.signature-invalid` on a bad signature
   * (nothing written), otherwise 200 for every handled outcome (Stripe retries only non-2xx; an
   * unknown payment or an amount mismatch would not get better by retrying). DB errors → 500 →
   * Stripe retries with backoff.
   */
  async handleStripe(headers: WebhookRequest['headers'], rawBody: Buffer | undefined) {
    const provider = requireProvider(this.providers, 'STRIPE');
    const result = provider.verifyWebhook({ headers, rawBody: rawBody ?? '', query: {} });
    if (result.status === 'IGNORED') return;
    const outcome = await this.confirmation.apply(this.toInput('STRIPE', result));
    this.logOutcome('STRIPE', result.paymentId, outcome);
  }

  /**
   * VNPay IPN: always HTTP 200 + `{RspCode, Message}` (503 only when VNPay is not configured).
   * Order of checks (VNPay spec): signature 97 → payment exists 01 → amount 04 → already
   * processed 02 → applied 00; unexpected error 99. 00 and 02 stop VNPay's retries.
   */
  async handleVnpayIpn(query: QueryRecord): Promise<VnpayIpnResponse> {
    const provider = requireProvider(this.providers, 'VNPAY');
    let result: WebhookPaymentResult;
    try {
      const verified = provider.verifyWebhook({ headers: {}, rawBody: '', query });
      if (verified.status === 'IGNORED') return VNPAY_IPN_RESPONSE.unknownError;
      result = verified;
    } catch (error) {
      if (error instanceof DomainError && error.code === 'payment.error.signature-invalid') {
        return VNPAY_IPN_RESPONSE.invalidSignature;
      }
      if (error instanceof DomainError && error.code === 'payment.error.amount-mismatch') {
        return VNPAY_IPN_RESPONSE.invalidAmount;
      }
      this.logger.error(error);
      return VNPAY_IPN_RESPONSE.unknownError;
    }
    try {
      const outcome = await this.confirmation.apply(this.toInput('VNPAY', result));
      this.logOutcome('VNPAY', result.paymentId, outcome);
      return VNPAY_IPN_REPLY[outcome];
    } catch (error) {
      this.logger.error(error);
      return VNPAY_IPN_RESPONSE.unknownError;
    }
  }

  /**
   * VNPay browser return: verify the signature, then pick the storefront page. Reads only — the
   * return URL is delivered by the customer's browser, so it never changes payment state (the
   * IPN does). Success: `{WEB_ORIGIN}/{locale}/order/success?orderId=…`; failed payment:
   * `/{locale}/order/payment-failed?orderId=…`; unverifiable / unknown: `/vi/order/payment-failed`
   * `?error=<code>`. Locale = the customer's `primaryLocale`.
   */
  async resolveVnpayReturn(query: QueryRecord): Promise<string> {
    const origin = this.env.WEB_ORIGIN.replace(/\/+$/, '');
    const failure = (error: string) =>
      `${origin}/vi/${PAYMENT_FAILED_PATH}?error=${encodeURIComponent(error)}`;
    const provider = this.providers.VNPAY;
    if (!provider) return failure('payment.error.provider-unavailable');
    let result: WebhookPaymentResult;
    try {
      const verified = provider.verifyWebhook({ headers: {}, rawBody: '', query });
      if (verified.status === 'IGNORED') return failure('payment.error.signature-invalid');
      result = verified;
    } catch (error) {
      if (error instanceof DomainError) return failure(error.code);
      throw error;
    }
    const payment = await this.prisma.client.payment.findFirst({
      where: { id: result.paymentId, provider: 'VNPAY' },
      select: {
        orderId: true,
        order: { select: { customer: { select: { primaryLocale: true } } } },
      },
    });
    if (!payment) return failure('order.error.not-found');
    const locale = payment.order.customer.primaryLocale.toLowerCase();
    const orderId = encodeURIComponent(payment.orderId);
    return result.status === 'CONFIRMED'
      ? `${origin}/${locale}/${PAYMENT_SUCCESS_PATH}?orderId=${orderId}`
      : `${origin}/${locale}/${PAYMENT_FAILED_PATH}?orderId=${orderId}`;
  }

  private toInput(provider: PaymentProviderId, result: WebhookPaymentResult) {
    return {
      provider,
      status: result.status,
      paymentId: result.paymentId,
      providerTxnId: result.providerTxnId,
      amount: result.amount,
      rawPayload: minimalRawPayload(provider, result.raw),
    };
  }

  private logOutcome(provider: PaymentProviderId, paymentId: string, outcome: ConfirmationOutcome) {
    const message = `${provider} webhook for payment ${paymentId}: ${outcome}`;
    if (outcome === 'not-found' || outcome === 'amount-mismatch') this.logger.warn(message);
    else this.logger.log(message);
  }
}
