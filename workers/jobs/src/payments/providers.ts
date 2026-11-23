import type { PaymentProvider as PaymentProviderId } from '@repo/core';
import { createStripeProvider, createVnpayProvider, type PaymentProvider } from '@repo/payments';
import Stripe from 'stripe';
import type { Env } from '../env';

/** Configured providers; a missing entry = disabled (its events dead-letter). */
export type Providers = Partial<Record<PaymentProviderId, PaymentProvider>>;

/**
 * Stripe calls run inside the outbox event's transaction (60s timeout): cap each request at 15s
 * with one network retry (worst case ~30s) instead of the SDK default 80s × 3, so a slow Stripe
 * becomes a normal `provider-unavailable` retry with backoff rather than a killed transaction.
 */
const STRIPE_TIMEOUT_MS = 15_000;
const STRIPE_NETWORK_RETRIES = 1;

/** Builds each provider whose credentials are present in the environment. */
export function createProviders(env: Env): Providers {
  const providers: Providers = {};
  if (env.VNPAY_TMN_CODE && env.VNPAY_HASH_SECRET && env.VNPAY_PAY_URL && env.VNPAY_API_URL) {
    // VNPay createSession only signs a URL locally (no network call).
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
      client: new Stripe(env.STRIPE_SECRET_KEY, {
        timeout: STRIPE_TIMEOUT_MS,
        maxNetworkRetries: STRIPE_NETWORK_RETRIES,
      }),
    });
  }
  return providers;
}
