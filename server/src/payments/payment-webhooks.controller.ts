import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { VnpayIpnResponse } from '@repo/payments';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignedWebhookRoute } from '../common/raw-body';
import { SkipRateLimit } from '../common/rate-limit';
import { PaymentWebhooksService, type QueryRecord } from './payment-webhooks.service';

/** Fastify's parsed query (`querystring` → strings / string arrays) as a typed record. */
function queryOf(request: FastifyRequest): QueryRecord {
  const query = request.query;
  if (typeof query !== 'object' || query === null) return {};
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.map(String);
  }
  return out;
}

/**
 * Payment-provider callbacks. Public (no JWT — authenticity is the provider signature), no
 * `@Idempotent()` (providers send no Idempotency-Key; replays are absorbed by the confirmation
 * transaction), and no rate limit on the server-to-server webhooks (shared provider egress IPs,
 * retries; the signature is checked before any DB I/O). Not in the OpenAPI spec / SDK: no
 * frontend calls them.
 */
@ApiExcludeController()
@Controller('payments')
export class PaymentWebhooksController {
  constructor(private readonly webhooks: PaymentWebhooksService) {}

  /** Stripe webhook: needs the exact raw body (signature over the bytes). */
  @Post('webhook/stripe')
  @HttpCode(200)
  @SignedWebhookRoute()
  async stripe(@Req() request: FastifyRequest): Promise<{ received: true }> {
    await this.webhooks.handleStripe(request.headers, request.rawBody);
    return { received: true };
  }

  /** VNPay IPN (server-to-server GET). Always 200 + `{RspCode, Message}`. */
  @Get('webhook/vnpay')
  @HttpCode(200)
  @SkipRateLimit()
  vnpayIpn(@Req() request: FastifyRequest): Promise<VnpayIpnResponse> {
    return this.webhooks.handleVnpayIpn(queryOf(request));
  }

  /** VNPay browser return: verify, then 302 to the storefront. Never changes payment state. */
  @Get('return/vnpay')
  async vnpayReturn(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const url = await this.webhooks.resolveVnpayReturn(queryOf(request));
    await reply.redirect(url, 302);
  }
}
