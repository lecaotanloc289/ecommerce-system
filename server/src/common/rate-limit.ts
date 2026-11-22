import rateLimit, { normalizeIP } from '@fastify/rate-limit';
import { RouteConfig, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DomainError } from '@repo/core';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

/** Named limit tiers a route can opt into (the default bucket needs no decorator). */
export type RateLimitTier = 'strict';

/**
 * Tighter limit for a sensitive handler (auth, checkout, payments): `RATE_LIMIT_STRICT_MAX`
 * requests per client IP per window, counted in a bucket of its own (per method + route), so
 * browsing never eats into the login/checkout budget. Fails closed (500) when Redis is down —
 * these routes must not lose brute-force protection. Method-level only (Fastify route config).
 */
export const RateLimit = (tier: RateLimitTier): MethodDecorator =>
  RouteConfig({ rateLimit: { skipOnError: false }, rateLimitTier: tier });

/** Exempts a handler from rate limiting (health probes from load balancers). Method-level only. */
export const SkipRateLimit = (): MethodDecorator => RouteConfig({ rateLimit: false });

/**
 * Client IP for rate limiting. `request.ips` (trustProxy is on) lists the socket peer first, then
 * the X-Forwarded-For entries from nearest to furthest. Each trusted proxy appends the address it
 * saw, so the real client is `TRUSTED_PROXY_HOPS` entries in; anything further left is
 * client-supplied and spoofable. Fewer entries than hops → the furthest one we have.
 */
export function clientIp(request: FastifyRequest, trustedProxyHops: number): string {
  const ips = request.ips ?? [request.ip];
  return normalizeIP(ips[Math.min(trustedProxyHops, ips.length - 1)] ?? request.ip);
}

/**
 * Registers `@fastify/rate-limit` with the shared Redis store. Every route is limited per client IP
 * (`clientIp`) to `RATE_LIMIT_MAX` per `RATE_LIMIT_WINDOW` in one shared bucket;
 * `@RateLimit('strict')` routes use `RATE_LIMIT_STRICT_MAX` in their own bucket. Over the
 * limit the hook throws a DomainError, which Nest's Fastify error handler sends through
 * DomainErrorFilter → 429 `common.error.rate-limited` (+ `retry-after` header).
 * The default bucket fails open (`skipOnError`) when Redis is unreachable: availability over
 * throttling for reads. Must run before `app.init()` / `listen()` — it hooks route registration.
 */
export async function registerRateLimit(app: NestFastifyApplication): Promise<void> {
  const env = app.get<Env>(ENV);
  const redis = app.get<Redis>(REDIS);
  await app.register(rateLimit, {
    global: true,
    redis,
    nameSpace: 'rl:',
    timeWindow: env.RATE_LIMIT_WINDOW * 1000,
    keyGenerator: (request) => clientIp(request, env.TRUSTED_PROXY_HOPS),
    max: (request) =>
      request.routeOptions.config.rateLimitTier === 'strict'
        ? env.RATE_LIMIT_STRICT_MAX
        : env.RATE_LIMIT_MAX,
    skipOnError: true,
    errorResponseBuilder: () => new DomainError('common.error.rate-limited'),
  });
}
