import { Logger } from '@nestjs/common';
import { DomainError, type PaymentProvider as PaymentProviderId } from '@repo/core';
import { createStripeProvider, createVnpayProvider, type PaymentProvider } from '@repo/payments';
import type { Env } from '../config/env';

/** Injection token: the configured gateways, keyed by provider id. A missing key = disabled. */
export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

export type PaymentProviders = Partial<Record<PaymentProviderId, PaymentProvider>>;

/**
 * Builds the gateways from env (no network I/O). A gateway whose keys are not all set is left
 * out — boot continues, and its webhook answers 503 `payment.error.provider-unavailable`.
 */
export function createPaymentProviders(env: Env): PaymentProviders {
  const logger = new Logger('PaymentProviders');
  const providers: PaymentProviders = {};
  if (env.VNPAY_TMN_CODE && env.VNPAY_HASH_SECRET) {
    providers.VNPAY = createVnpayProvider({
      tmnCode: env.VNPAY_TMN_CODE,
      hashSecret: env.VNPAY_HASH_SECRET,
      payUrl: env.VNPAY_PAY_URL,
      apiUrl: env.VNPAY_API_URL,
    });
  } else {
    logger.warn('VNPay disabled: VNPAY_TMN_CODE / VNPAY_HASH_SECRET not set');
  }
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) {
    providers.STRIPE = createStripeProvider({
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    });
  } else {
    logger.warn('Stripe disabled: STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set');
  }
  return providers;
}

/** The configured gateway, or 503 `payment.error.provider-unavailable`. */
export function requireProvider(
  providers: PaymentProviders,
  id: PaymentProviderId,
): PaymentProvider {
  const provider = providers[id];
  if (!provider) {
    throw new DomainError('payment.error.provider-unavailable', {
      provider: id,
      reason: 'not-configured',
    });
  }
  return provider;
}
