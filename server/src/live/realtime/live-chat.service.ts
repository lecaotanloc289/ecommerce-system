import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DomainError,
  type LiveChatMessage,
  LiveChatMessageSchema,
  LiveSessionStatus,
  type SendLiveChatMessage,
} from '@repo/core';
import type Redis from 'ioredis';
import type { AuthUser } from '../../auth/auth.schemas';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { LiveEventsPublisher } from '../live-events.publisher';
import { LIVE_REALTIME_KEY_TTL_MS, liveKeys } from '../live-redis-keys';
import { LiveSessionService } from '../live-session.service';
import { LiveSessionStatusCache, LiveUserRateLimiter } from './live-realtime-guards';

/** `XADD MAXLEN ~` — the stream keeps roughly the last N messages (plan §1.5). */
const CHAT_STREAM_MAXLEN = 200;
/** A retried POST with the same `clientMessageId` within this window replays the original. */
const CHAT_DEDUPE_TTL_SECONDS = 600;

export interface SendChatResult {
  message: LiveChatMessage;
  /** false = replay of an earlier POST with the same `clientMessageId`. */
  isCreated: boolean;
}

/** Dedupe key states besides a stored message JSON. */
const DEDUPE_PENDING = 'pending';
const DEDUPE_DELETED = 'deleted';

/**
 * Live chat in Redis only (decision D5): `live:{id}:chat` Stream, message id = entry id.
 * Sending: per-user cap (all sessions, before any DB read) → LIVE (status cached 1 s) → not
 * muted → claim `chat-dedupe:{clientMessageId}` (`SET NX` placeholder: concurrent duplicates
 * see it and get 409, a finished one is replayed) → cooldown (`SET NX PX`,
 * `PlatformSettings.liveChatCooldownSeconds`) → `XADD` (the write: a failure fails the request
 * and releases the claim + cooldown) → store the message under the claim → publish
 * `chat.message` (best-effort). `displayName` comes from the DB, never from the client; the
 * text is plain text (clients render it as text).
 */
@Injectable()
export class LiveChatService {
  private readonly logger = new Logger(LiveChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: LiveSessionService,
    private readonly statuses: LiveSessionStatusCache,
    private readonly userLimiter: LiveUserRateLimiter,
    private readonly publisher: LiveEventsPublisher,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async send(
    user: AuthUser,
    sessionId: string,
    input: SendLiveChatMessage,
  ): Promise<SendChatResult> {
    await this.userLimiter.assertAllowed(user.id);
    const [status, author] = await Promise.all([
      this.statuses.get(sessionId),
      this.prisma.client.user.findUnique({ where: { id: user.id }, select: { name: true } }),
    ]);
    if (!author) throw new DomainError('common.error.unauthorized');
    if (status !== LiveSessionStatus.LIVE) throw new DomainError('live.error.not-live');
    if ((await this.redis.sismember(liveKeys.muted(sessionId), user.id)) === 1) {
      throw new DomainError('live.error.chat-muted');
    }

    const dedupeKey = liveKeys.chatDedupe(sessionId, input.clientMessageId);
    const claimed = await this.redis.set(
      dedupeKey,
      DEDUPE_PENDING,
      'EX',
      CHAT_DEDUPE_TTL_SECONDS,
      'NX',
    );
    if (claimed !== 'OK') {
      return { message: await this.replayOrConflict(dedupeKey, user.id), isCreated: false };
    }

    let entryId: string;
    try {
      entryId = await this.append(sessionId, user.id, author.name, input);
    } catch (error) {
      // Nothing was stored: a retry with the same clientMessageId must be processed.
      await this.redis.del(dedupeKey).catch(() => 0);
      throw error;
    }

    const message = LiveChatMessageSchema.parse({
      id: entryId,
      sessionId,
      userId: user.id,
      displayName: author.name,
      text: input.text,
      sentAt: entryIdToIso(entryId),
    });
    try {
      await this.redis.set(dedupeKey, JSON.stringify(message), 'EX', CHAT_DEDUPE_TTL_SECONDS);
    } catch (error) {
      // The claim stays "pending": retries get 409 instead of a duplicate message.
      this.logger.warn({ err: error, sessionId }, 'live chat dedupe write failed');
    }
    await this.publisher.publish({ type: 'chat.message', message });
    return { message, isCreated: true };
  }

  /** Last `limit` messages, oldest first. Publicly visible sessions only (ended: 24 h replay). */
  async history(sessionId: string, limit: number): Promise<LiveChatMessage[]> {
    await this.statuses.get(sessionId);
    const entries = await this.redis.xrevrange(liveKeys.chat(sessionId), '+', '-', 'COUNT', limit);
    const messages: LiveChatMessage[] = [];
    for (const [id, fields] of entries.reverse()) {
      const parsed = LiveChatMessageSchema.safeParse({
        ...fieldsToRecord(fields),
        id,
        sessionId,
        sentAt: entryIdToIso(id),
      });
      if (parsed.success) messages.push(parsed.data);
      else this.logger.warn({ sessionId, id }, 'skipped malformed live chat entry');
    }
    return messages;
  }

  /**
   * Vendor moderation: `XDEL` + `chat.deleted`. Idempotent (already gone → no event). The
   * message's dedupe entry becomes a tombstone first, so a client retry of the same
   * `clientMessageId` gets 409 instead of replaying (or re-posting) the deleted message.
   */
  async deleteMessage(user: AuthUser, sessionId: string, messageId: string): Promise<void> {
    await this.sessions.getOwnedStatus(user, sessionId);
    const chatKey = liveKeys.chat(sessionId);
    const [entry] = await this.redis.xrange(chatKey, messageId, messageId);
    const clientMessageId = entry ? fieldsToRecord(entry[1]).clientMessageId : undefined;
    if (clientMessageId !== undefined) {
      await this.redis.set(
        liveKeys.chatDedupe(sessionId, clientMessageId),
        DEDUPE_DELETED,
        'KEEPTTL',
        'XX',
      );
    }
    const removed = await this.redis.xdel(chatKey, messageId);
    if (removed > 0) await this.publisher.publish({ type: 'chat.deleted', sessionId, messageId });
  }

  /** Vendor moderation (own session). The muted SET gets the rolling 24 h TTL. */
  async mute(user: AuthUser, sessionId: string, userId: string): Promise<void> {
    await this.sessions.getOwnedStatus(user, sessionId);
    const key = liveKeys.muted(sessionId);
    await this.redis.multi().sadd(key, userId).pexpire(key, LIVE_REALTIME_KEY_TTL_MS).exec();
  }

  async unmute(user: AuthUser, sessionId: string, userId: string): Promise<void> {
    await this.sessions.getOwnedStatus(user, sessionId);
    await this.redis.srem(liveKeys.muted(sessionId), userId);
  }

  /** See LIVE_REALTIME_KEY_TTL_MS. Best-effort: the message is already stored. */
  private async refreshTtl(key: string): Promise<void> {
    try {
      await this.redis.pexpire(key, LIVE_REALTIME_KEY_TTL_MS);
    } catch (error) {
      this.logger.warn({ err: error, key }, 'live chat TTL refresh failed');
    }
  }

  /** Cooldown → `XADD` (+ rolling TTL). Returns the entry id; releases the cooldown on failure. */
  private async append(
    sessionId: string,
    userId: string,
    displayName: string,
    input: SendLiveChatMessage,
  ): Promise<string> {
    const cooldownKey = liveKeys.cooldown(sessionId, userId);
    const cooldownMs = (await this.readCooldownSeconds()) * 1000;
    if (cooldownMs > 0) {
      const acquired = await this.redis.set(cooldownKey, '1', 'PX', cooldownMs, 'NX');
      if (acquired === null) throw new DomainError('live.error.chat-rate-limited');
    }
    let entryId: string | null;
    try {
      entryId = await this.redis.xadd(
        liveKeys.chat(sessionId),
        'MAXLEN',
        '~',
        CHAT_STREAM_MAXLEN,
        '*',
        'userId',
        userId,
        'displayName',
        displayName,
        'text',
        input.text,
        // Not part of the message DTO (stripped on read); lets a delete tombstone the dedupe key.
        'clientMessageId',
        input.clientMessageId,
      );
      if (entryId === null) throw new Error('XADD returned no id');
    } catch (error) {
      if (cooldownMs > 0) await this.redis.del(cooldownKey).catch(() => 0);
      throw error;
    }
    await this.refreshTtl(liveKeys.chat(sessionId));
    return entryId;
  }

  /**
   * The dedupe key was already claimed: a finished send by the same user is replayed; anything
   * else (in flight, deleted by the vendor, another user's id) → 409 `common.error.conflict`.
   */
  private async replayOrConflict(dedupeKey: string, userId: string): Promise<LiveChatMessage> {
    const stored = await this.redis.get(dedupeKey);
    if (stored !== null && stored !== DEDUPE_PENDING && stored !== DEDUPE_DELETED) {
      let json: unknown = null;
      try {
        json = JSON.parse(stored);
      } catch {
        // not JSON → json stays null → conflict below
      }
      const parsed = LiveChatMessageSchema.safeParse(json);
      if (parsed.success && parsed.data.userId === userId) return parsed.data;
    }
    throw new DomainError('common.error.conflict');
  }

  /** `PlatformSettings.liveChatCooldownSeconds` (tunable, never hardcoded). */
  private async readCooldownSeconds(): Promise<number> {
    const settings = await this.prisma.client.platformSettings.findFirst({
      select: { liveChatCooldownSeconds: true },
    });
    if (!settings) throw new Error('PlatformSettings row is missing');
    return Math.max(0, settings.liveChatCooldownSeconds);
  }
}

/** Stream entry ids are `<ms>-<seq>` of the Redis server clock — the message's send time. */
function entryIdToIso(entryId: string): string {
  const ms = Number(entryId.split('-')[0]);
  return new Date(ms).toISOString();
}

function fieldsToRecord(fields: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const name = fields[i];
    const value = fields[i + 1];
    if (name !== undefined && value !== undefined) record[name] = value;
  }
  return record;
}
