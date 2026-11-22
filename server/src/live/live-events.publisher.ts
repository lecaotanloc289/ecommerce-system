import { Inject, Injectable, Logger } from '@nestjs/common';
import { LiveEventSchema } from '@repo/core';
import type Redis from 'ioredis';
import type { z } from 'zod';
import { REDIS } from '../redis/redis.module';
import { liveKeys } from './live-redis-keys';

/** Unbranded event shape (plain-string ids) — branded by validation before publishing. */
export type LiveEventInput = z.input<typeof LiveEventSchema>;

/**
 * Publishes realtime `LiveEvent`s on `live:{id}:events` (plan §1.5). Call only AFTER the DB
 * transaction has committed. Best-effort: realtime is a notification channel, not the source of
 * truth, so a Redis failure or an invalid event is logged and never fails the (already
 * committed) request.
 */
@Injectable()
export class LiveEventsPublisher {
  private readonly logger = new Logger(LiveEventsPublisher.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(event: LiveEventInput): Promise<void> {
    const parsed = LiveEventSchema.safeParse(event);
    if (!parsed.success) {
      this.logger.error({ type: event.type, issues: parsed.error.issues }, 'invalid live event');
      return;
    }
    const sessionId =
      parsed.data.type === 'chat.message' ? parsed.data.message.sessionId : parsed.data.sessionId;
    try {
      await this.redis.publish(liveKeys.events(sessionId), JSON.stringify(parsed.data));
    } catch (error) {
      this.logger.warn(
        { err: error, sessionId, type: parsed.data.type },
        'live event publish failed',
      );
    }
  }
}
