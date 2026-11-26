import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type LiveEvent, LiveEventSchema } from '@repo/core';
import type Redis from 'ioredis';
import { type Observable, Subject } from 'rxjs';
import { REDIS } from '../../redis/redis.module';
import { liveKeys } from '../live-redis-keys';

const EVENTS_CHANNEL = /^live:(.+):events$/;

interface ChannelEntry {
  subject: Subject<LiveEvent>;
  refs: number;
  /** Resolves once Redis acknowledged the SUBSCRIBE (shared by concurrent joiners). */
  ready: Promise<void>;
}

export interface LiveEventSubscription {
  events: Observable<LiveEvent>;
  /** Idempotent. The last local listener of a session unsubscribes the Redis channel. */
  leave(): void;
}

/**
 * Fan-out of `live:{id}:events` to this instance's SSE clients.
 *
 * One dedicated subscriber connection per instance (`redis.duplicate()`, created on first use —
 * a connection in subscriber mode can't run other commands). Channels are SUBSCRIBEd per
 * session with ref-counting rather than one `PSUBSCRIBE live:*:events`: an instance then only
 * receives traffic (chat, reactions, viewer counts) for sessions it has local viewers for,
 * instead of every session on the platform. SUBSCRIBE/UNSUBSCRIBE go over the same connection,
 * so Redis applies them in order — a join right after the last leave re-subscribes correctly.
 * ioredis re-subscribes automatically after a reconnect.
 *
 * Every incoming message is validated with `LiveEventSchema` (and must match its channel's
 * session) before it reaches clients; anything else is dropped and logged.
 */
@Injectable()
export class LiveRealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveRealtimeService.name);
  private readonly channels = new Map<string, ChannelEntry>();
  private subscriber: Redis | null = null;
  private isDestroyed = false;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async join(sessionId: string): Promise<LiveEventSubscription> {
    if (this.isDestroyed) throw new Error('LiveRealtimeService is shutting down');
    let entry = this.channels.get(sessionId);
    if (!entry) {
      const subscriber = this.getSubscriber();
      const ready = subscriber.subscribe(liveKeys.events(sessionId)).then(() => undefined);
      entry = { subject: new Subject<LiveEvent>(), refs: 0, ready };
      this.channels.set(sessionId, entry);
    }
    entry.refs += 1;

    let isLeft = false;
    const leave = () => {
      if (isLeft) return;
      isLeft = true;
      this.release(sessionId);
    };
    try {
      await entry.ready;
    } catch (error) {
      leave();
      throw error;
    }
    return { events: entry.subject.asObservable(), leave };
  }

  /** Sessions with at least one local listener (diagnostics / tests). */
  localSessionCount(): number {
    return this.channels.size;
  }

  async onModuleDestroy(): Promise<void> {
    this.isDestroyed = true;
    for (const entry of this.channels.values()) entry.subject.complete();
    this.channels.clear();
    const subscriber = this.subscriber;
    this.subscriber = null;
    if (subscriber) {
      try {
        await subscriber.quit();
      } catch {
        subscriber.disconnect();
      }
    }
  }

  private release(sessionId: string): void {
    const entry = this.channels.get(sessionId);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    this.channels.delete(sessionId);
    entry.subject.complete();
    this.subscriber?.unsubscribe(liveKeys.events(sessionId)).catch((error: unknown) => {
      this.logger.warn({ err: error, sessionId }, 'live events unsubscribe failed');
    });
  }

  private getSubscriber(): Redis {
    if (this.subscriber) return this.subscriber;
    const subscriber = this.redis.duplicate();
    subscriber.on('message', (channel: string, message: string) => {
      this.onMessage(channel, message);
    });
    subscriber.on('error', (error: unknown) => {
      this.logger.warn({ err: error }, 'live events subscriber error');
    });
    this.subscriber = subscriber;
    return subscriber;
  }

  private onMessage(channel: string, message: string): void {
    const sessionId = EVENTS_CHANNEL.exec(channel)?.[1];
    const entry = sessionId === undefined ? undefined : this.channels.get(sessionId);
    if (!entry) return;

    let json: unknown;
    try {
      json = JSON.parse(message);
    } catch {
      this.logger.warn({ channel }, 'dropped live event: not JSON');
      return;
    }
    const parsed = LiveEventSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn({ channel, issues: parsed.error.issues }, 'dropped invalid live event');
      return;
    }
    const event = parsed.data;
    const eventSessionId =
      event.type === 'chat.message' ? event.message.sessionId : event.sessionId;
    if (eventSessionId !== sessionId) {
      this.logger.warn({ channel, type: event.type }, 'dropped live event for another session');
      return;
    }
    entry.subject.next(event);
  }
}
