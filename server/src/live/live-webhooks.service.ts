import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@repo/core';
import {
  parseLiveInputNotification,
  parseStreamVideoWebhook,
  STREAM_SIGNATURE_HEADER,
  verifyNotificationWebhook,
  verifyStreamWebhookSignature,
  type WebhookHeaders,
} from '@repo/streaming';
import type Redis from 'ioredis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { REDIS } from '../redis/redis.module';
import {
  LIVE_WEBHOOK_CLAIM_TTL_SECONDS,
  LIVE_WEBHOOK_DEDUPE_TTL_SECONDS,
  liveKeys,
} from './live-redis-keys';
import { LiveSessionService } from './live-session.service';

export interface WebhookDelivery {
  headers: WebhookHeaders;
  /** Body bytes exactly as received (signature + dedupe hash). */
  rawBody: Buffer | undefined;
  /** The same body, JSON-parsed. */
  body: unknown;
}

/**
 * Cloudflare webhooks. Order: authenticate → claim the delivery in Redis (replay guard: the
 * Notifications secret is static with no timestamp, so a captured request could otherwise be
 * replayed) → parse → apply. A delivery that fails while being applied releases its claim so the
 * provider's retry is processed. Junk / unknown inputs are acknowledged (204) and logged so the
 * provider does not retry them forever.
 */
@Injectable()
export class LiveWebhooksService {
  private readonly logger = new Logger(LiveWebhooksService.name);

  constructor(
    private readonly sessions: LiveSessionService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Notifications "Stream Live Input" webhook (`cf-webhook-auth`). */
  async handleLiveInput({ headers, rawBody, body }: WebhookDelivery): Promise<void> {
    const secret = this.env.CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET;
    if (!rawBody || !secret || !verifyNotificationWebhook(headers, secret)) {
      throw new DomainError('live.error.webhook-signature-invalid');
    }
    await this.processOnce(rawBody, async () => {
      const notification = parseLiveInputNotification(body);
      if (!notification) {
        this.logger.warn('ignored unparseable live-input notification');
        return;
      }
      const outcome = await this.sessions.applyEncoderEvent({
        liveInputId: notification.liveInputId,
        // `errored` = the input is not delivering a usable stream: treat like a disconnect so
        // the grace job can end a broken broadcast.
        isConnected: notification.event === 'connected',
        occurredAt: notification.occurredAt,
      });
      if (outcome !== 'applied') {
        this.logger.log(
          { liveInputId: notification.liveInputId, event: notification.event, outcome },
          'live-input notification not applied',
        );
      }
    });
  }

  /** Stream video webhook (`Webhook-Signature` HMAC over the raw body). */
  async handleStreamVideo({ headers, rawBody, body }: WebhookDelivery): Promise<void> {
    const secret = this.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
    const signatureHeader = headerValue(headers, STREAM_SIGNATURE_HEADER);
    const isValid =
      rawBody !== undefined &&
      secret !== undefined &&
      verifyStreamWebhookSignature({
        signatureHeader,
        rawBody,
        secret,
        nowSeconds: Math.floor(Date.now() / 1000),
      });
    if (!isValid || !rawBody) throw new DomainError('live.error.webhook-signature-invalid');

    await this.processOnce(rawBody, async () => {
      const video = parseStreamVideoWebhook(body);
      if (!video) {
        this.logger.warn('ignored unparseable stream video webhook');
        return;
      }
      if (!video.readyToStream) return;
      if (video.liveInputId === null) {
        // Plain uploads, or a live recording without `liveInput` (see @repo/streaming CLAUDE.md).
        this.logger.log({ videoId: video.videoId }, 'ignored stream video without live input');
        return;
      }
      await this.sessions.attachRecording(video.liveInputId, video.videoId);
    });
  }

  private async processOnce(rawBody: Buffer, apply: () => Promise<void>): Promise<void> {
    const key = liveKeys.webhookDedupe(createHash('sha256').update(rawBody).digest('hex'));
    // Short claim first: if this process dies mid-apply, the provider's retry is processed once
    // the claim lapses. Extended to the full dedupe window only after a successful apply.
    const claimed = await this.redis.set(key, '1', 'EX', LIVE_WEBHOOK_CLAIM_TTL_SECONDS, 'NX');
    if (claimed !== 'OK') {
      this.logger.log({ key }, 'duplicate webhook delivery ignored');
      return;
    }
    try {
      await apply();
    } catch (error) {
      await this.redis.del(key);
      throw error;
    }
    try {
      await this.redis.expire(key, LIVE_WEBHOOK_DEDUPE_TTL_SECONDS);
    } catch (error) {
      // Applied already; the short claim still blocks immediate replays.
      this.logger.warn({ err: error, key }, 'extending webhook dedupe claim failed');
    }
  }
}

function headerValue(headers: WebhookHeaders, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}
