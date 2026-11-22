import type { PaymentProvider as PaymentProviderId } from '@repo/core';
import { createStripeProvider, createVnpayProvider, type PaymentProvider } from '@repo/payments';
import type { Env } from '../env';

/** Configured providers; a missing entry = disabled (its events dead-letter). */
export type Providers = Partial<Record<PaymentProviderId, PaymentProvider>>;

/** Builds each provider whose credentials are present in the environment. */
export function createProviders(env: Env): Providers {
  const providers: Providers = {};
  if (env.VNPAY_TMN_CODE && env.VNPAY_HASH_SECRET && env.VNPAY_PAY_URL && env.VNPAY_API_URL) {
    providers.VNPAY = createVnpayProvider({
      tmnCode: env.VNPAY_TMN_CODE,
      hashSecret: env.VNPAY_HASH_SECRET,
      payUrl: env.VNPAY_PAY_URL,
      apiUrl: env.VNPAY_API_URL,
    });
  }
  if (env.STRIPE_SECRET_KEY) {
    providers.STRIPE = createStripeProvider({
      secretKey: env.STRIPE_SECRET_KEY,
      // The worker only creates sessions; webhooks are verified by the API.
      webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    });
  }
  return providers;
}
