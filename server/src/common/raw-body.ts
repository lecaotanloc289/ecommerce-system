import { PassThrough } from 'node:stream';
import { RouteConfig, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DomainError } from '@repo/core';

/**
 * Route config for a payment-provider webhook that signs its body (Stripe): keeps the exact
 * request bytes on `request.rawBody` (see `registerRawBodyCapture`) and exempts the route from
 * rate limiting — providers send from shared egress IPs and retry on errors, and the signature
 * check runs before any DB I/O. One decorator because Nest's `@RouteConfig` metadata does not
 * merge (a second `@RouteConfig` / `@SkipRateLimit()` on the same handler would replace it).
 */
export const SignedWebhookRoute = (): MethodDecorator =>
  RouteConfig({ rateLimit: false, rawBody: true });

/**
 * `preParsing` hook: for routes whose config has `rawBody: true`, buffers the body (up to the
 * route's body limit, else 422 `common.error.validation-failed` — checked on the declared
 * Content-Length before reading and again while reading), stores it on `request.rawBody`, and hands the same bytes to the
 * normal content-type parser. Every other route is untouched (JSON parsing is unchanged; no raw
 * copy is kept). Must run before `app.init()` like `registerRateLimit`.
 */
export function registerRawBodyCapture(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('preParsing', async (request, _reply, payload) => {
    if (request.routeOptions.config.rawBody !== true) return payload;
    const limit = request.routeOptions.bodyLimit ?? fastify.initialConfig.bodyLimit ?? 1_048_576;
    const tooLarge = () =>
      new DomainError('common.error.validation-failed', { reason: 'body-too-large' });
    if (Number(request.headers['content-length'] ?? 0) > limit) throw tooLarge();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of payload) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.length;
      if (size > limit) throw tooLarge();
      chunks.push(buffer);
    }
    const raw = Buffer.concat(chunks);
    request.rawBody = raw;
    const replay = new PassThrough();
    replay.end(raw);
    return replay;
  });
}
