import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { LiveWebhooksService } from './live-webhooks.service';

/**
 * Cloudflare → server. Unauthenticated at the guard level: each handler verifies the provider's
 * auth itself. `rawBody: true` keeps the exact body bytes (see common/raw-body.ts).
 */
@Controller('webhooks/cloudflare')
export class LiveWebhooksController {
  constructor(private readonly webhooks: LiveWebhooksService) {}

  @Post('live-input')
  @HttpCode(204)
  @RouteConfig({ rawBody: true })
  liveInput(@Req() request: FastifyRequest): Promise<void> {
    return this.webhooks.handleLiveInput({
      headers: request.headers,
      rawBody: request.rawBody,
      body: request.body,
    });
  }

  @Post('stream')
  @HttpCode(204)
  @RouteConfig({ rawBody: true })
  stream(@Req() request: FastifyRequest): Promise<void> {
    return this.webhooks.handleStreamVideo({
      headers: request.headers,
      rawBody: request.rawBody,
      body: request.body,
    });
  }
}
