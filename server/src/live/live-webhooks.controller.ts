import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { SignedWebhookRoute } from '../common/raw-body';
import type { FastifyRequest } from 'fastify';
import { LiveWebhooksService } from './live-webhooks.service';

/**
 * Cloudflare → server. Unauthenticated at the guard level: each handler verifies the provider's
 * auth itself. `@SignedWebhookRoute()` keeps the exact body bytes and skips rate limiting (see common/raw-body.ts).
 */
@Controller('webhooks/cloudflare')
export class LiveWebhooksController {
  constructor(private readonly webhooks: LiveWebhooksService) {}

  @Post('live-input')
  @HttpCode(204)
  @SignedWebhookRoute()
  liveInput(@Req() request: FastifyRequest): Promise<void> {
    return this.webhooks.handleLiveInput({
      headers: request.headers,
      rawBody: request.rawBody,
      body: request.body,
    });
  }

  @Post('stream')
  @HttpCode(204)
  @SignedWebhookRoute()
  stream(@Req() request: FastifyRequest): Promise<void> {
    return this.webhooks.handleStreamVideo({
      headers: request.headers,
      rawBody: request.rawBody,
      body: request.body,
    });
  }
}
