import { ulid } from 'ulid';
import { liveKeys } from '../../../src/live/live-redis-keys';
import {
  addVendorStaff,
  createUser,
  createVendor,
  resetDatabase,
  resetRedis,
  type TestVendor,
} from '../../integration/pg';
import { captureLiveEvents, createLiveTestApp, type LiveTestApp } from '../live-test-app';
import { createPlatformSettings, liveSession, scheduledSession } from './realtime-helpers';

type Captured = Awaited<ReturnType<typeof captureLiveEvents>>;

/** Chat, reactions and vendor moderation over HTTP (inject), real Postgres + Redis. */
describe('Live chat, reactions and moderation HTTP', () => {
  let ctx: LiveTestApp;
  let capture: Captured;
  let vendor: TestVendor;
  let customerId: string;

  beforeAll(async () => {
    ctx = await createLiveTestApp({ realtime: { reactionFlushMs: 200 } });
    capture = await captureLiveEvents(ctx.env.REDIS_URL);
  });

  afterAll(async () => {
    await capture?.close();
    await ctx?.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.db);
    await resetRedis(ctx.redis);
    vendor = await createVendor(ctx.db);
    customerId = await createUser(ctx.db);
  });

  async function post(url: string, userId: string | null, payload?: object) {
    return ctx.app.inject({
      method: 'POST',
      url: `/v1${url}`,
      headers: userId === null ? {} : await ctx.authHeader(userId),
      ...(payload !== undefined && { payload }),
    });
  }

  const say = (
    sessionId: string,
    userId: string | null,
    text = 'Xin chào!',
    clientMessageId = ulid(),
  ) => post(`/live-sessions/${sessionId}/messages`, userId, { clientMessageId, text });

  describe('POST /live-sessions/:id/messages', () => {
    it('201 with displayName from the DB; published; listed oldest first', async () => {
      await createPlatformSettings(ctx, 0);
      const { sessionId } = await liveSession(ctx, vendor);
      await ctx.db.user.update({ where: { id: customerId }, data: { name: 'Lan Anh' } });

      const first = await post(`/live-sessions/${sessionId}/messages`, customerId, {
        clientMessageId: ulid(),
        text: '  first  ',
        displayName: 'spoofed',
        userId: ulid(),
      });
      expect(first.statusCode).toBe(201);
      const message = first.json<{ id: string }>();
      expect(message).toEqual({
        id: expect.stringMatching(/^\d+-\d+$/),
        sessionId,
        userId: customerId,
        displayName: 'Lan Anh',
        text: 'first',
        sentAt: expect.any(String),
      });
      expect((await say(sessionId, customerId, 'second')).statusCode).toBe(201);
      expect((await say(sessionId, customerId, 'third')).statusCode).toBe(201);

      const events = await capture.forSession(sessionId);
      expect(events.filter((e) => e.type === 'chat.message')[0]).toEqual({
        type: 'chat.message',
        message,
      });

      const all = await ctx.app.inject({
        method: 'GET',
        url: `/v1/live-sessions/${sessionId}/messages`,
      });
      expect(all.statusCode).toBe(200);
      expect(all.json<{ text: string }[]>().map((m) => m.text)).toEqual([
        'first',
        'second',
        'third',
      ]);
      expect(all.json<unknown[]>()[0]).toEqual(message);

      const lastTwo = await ctx.app.inject({
        method: 'GET',
        url: `/v1/live-sessions/${sessionId}/messages?limit=2`,
      });
      expect(lastTwo.json<{ text: string }[]>().map((m) => m.text)).toEqual(['second', 'third']);

      const badLimit = await ctx.app.inject({
        method: 'GET',
        url: `/v1/live-sessions/${sessionId}/messages?limit=101`,
      });
      expect(badLimit.statusCode).toBe(422);
      const unknown = await ctx.app.inject({
        method: 'GET',
        url: `/v1/live-sessions/${ulid()}/messages`,
      });
      expect(unknown.statusCode).toBe(404);
    });

    it('guest 401; not live 409; unknown session 404', async () => {
      await createPlatformSettings(ctx);
      const { sessionId } = await scheduledSession(ctx, vendor);

      const guest = await say(sessionId, null);
      expect(guest.statusCode).toBe(401);

      const notLive = await say(sessionId, customerId);
      expect(notLive.statusCode).toBe(409);
      expect(notLive.json()).toEqual({ errorCode: 'live.error.not-live', params: {} });

      expect((await say(ulid(), customerId)).statusCode).toBe(404);
    });

    it('validates the body: > 200 chars, blank text, bad clientMessageId → 422', async () => {
      await createPlatformSettings(ctx, 0);
      const { sessionId } = await liveSession(ctx, vendor);

      const long = await say(sessionId, customerId, 'x'.repeat(201));
      expect(long.statusCode).toBe(422);
      expect(long.json()).toEqual({ errorCode: 'common.error.validation-failed', params: {} });
      expect((await say(sessionId, customerId, '   ')).statusCode).toBe(422);
      expect((await say(sessionId, customerId, 'ok', 'nope')).statusCode).toBe(422);
      expect((await say(sessionId, customerId, 'x'.repeat(200))).statusCode).toBe(201);
    });

    it('muted user → 403 until unmuted', async () => {
      await createPlatformSettings(ctx, 0);
      const { sessionId } = await liveSession(ctx, vendor);

      expect(
        (
          await post(`/vendor/live-sessions/${sessionId}/mutes`, vendor.ownerId, {
            userId: customerId,
          })
        ).statusCode,
      ).toBe(204);
      const muted = await say(sessionId, customerId);
      expect(muted.statusCode).toBe(403);
      expect(muted.json()).toEqual({ errorCode: 'live.error.chat-muted', params: {} });

      expect(
        (
          await post(
            `/vendor/live-sessions/${sessionId}/mutes/${customerId}/unmute`,
            vendor.ownerId,
          )
        ).statusCode,
      ).toBe(204);
      expect((await say(sessionId, customerId)).statusCode).toBe(201);
    });

    it('cooldown boundary: 2nd within the cooldown 429, after it 201', async () => {
      await createPlatformSettings(ctx, 1);
      const { sessionId } = await liveSession(ctx, vendor);

      expect((await say(sessionId, customerId)).statusCode).toBe(201);
      const tooSoon = await say(sessionId, customerId);
      expect(tooSoon.statusCode).toBe(429);
      expect(tooSoon.json()).toEqual({ errorCode: 'live.error.chat-rate-limited', params: {} });

      // Another user is not affected by this user's cooldown.
      expect((await say(sessionId, await createUser(ctx.db))).statusCode).toBe(201);

      await new Promise((resolve) => setTimeout(resolve, 1_050));
      expect((await say(sessionId, customerId)).statusCode).toBe(201);
    });

    it('dedupe: a replay of the same clientMessageId returns the original (200), stored once', async () => {
      await createPlatformSettings(ctx, 5);
      const { sessionId } = await liveSession(ctx, vendor);
      const clientMessageId = ulid();

      const created = await say(sessionId, customerId, 'hello', clientMessageId);
      expect(created.statusCode).toBe(201);
      // Within the cooldown: still a replay, not a 429.
      const replay = await say(sessionId, customerId, 'hello', clientMessageId);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(created.json());
      expect(await ctx.redis.xlen(liveKeys.chat(sessionId))).toBe(1);
      expect(await ctx.redis.ttl(liveKeys.chat(sessionId))).toBeGreaterThan(86_000);
    });

    it('dedupe is atomic: concurrent POSTs with one clientMessageId store one message', async () => {
      for (const cooldownSeconds of [0, 5]) {
        await resetDatabase(ctx.db);
        await resetRedis(ctx.redis);
        vendor = await createVendor(ctx.db);
        customerId = await createUser(ctx.db);
        await createPlatformSettings(ctx, cooldownSeconds);
        const { sessionId } = await liveSession(ctx, vendor);
        const headers = await ctx.authHeader(customerId);
        const payload = { clientMessageId: ulid(), text: 'same' };

        const responses = await Promise.all(
          Array.from({ length: 5 }, () =>
            ctx.app.inject({
              method: 'POST',
              url: `/v1/live-sessions/${sessionId}/messages`,
              headers,
              payload,
            }),
          ),
        );
        const statuses = responses.map((r) => r.statusCode);
        expect(statuses.filter((s) => s === 201)).toHaveLength(1);
        // Others: replay (200) once the first finished, or 409 while it was in flight — never a
        // second message and never a 429 from the cooldown.
        expect(statuses.every((s) => s === 201 || s === 200 || s === 409)).toBe(true);
        expect(await ctx.redis.xlen(liveKeys.chat(sessionId))).toBe(1);
      }
    });

    it('a pending claim → 409 common.error.conflict; a failed send releases its claim', async () => {
      await createPlatformSettings(ctx, 5);
      const { sessionId } = await liveSession(ctx, vendor);
      const pending = ulid();
      await ctx.redis.set(liveKeys.chatDedupe(sessionId, pending), 'pending', 'EX', 60);
      const inFlight = await say(sessionId, customerId, 'x', pending);
      expect(inFlight.statusCode).toBe(409);
      expect(inFlight.json()).toEqual({ errorCode: 'common.error.conflict', params: {} });

      expect((await say(sessionId, customerId, 'first')).statusCode).toBe(201);
      const retried = ulid();
      expect((await say(sessionId, customerId, 'cooling', retried)).statusCode).toBe(429);
      // The 429 released the claim: the same id is processed again later, not stuck at 409.
      expect(await ctx.redis.exists(liveKeys.chatDedupe(sessionId, retried))).toBe(0);
    });
  });

  describe('per-user limits before any DB read', () => {
    it('caps chat + reactions per user across sessions; unknown sessions are cached as 404', async () => {
      const lookups = jest.spyOn(ctx.service, 'getPublicStatus');
      const headers = await ctx.authHeader(customerId);
      const responses = await Promise.all(
        Array.from({ length: 21 }, () =>
          ctx.app.inject({
            method: 'POST',
            url: `/v1/live-sessions/${ulid()}/reactions`,
            headers,
            payload: { kind: 'HEART' },
          }),
        ),
      );
      const statuses = responses.map((r) => r.statusCode).sort();
      expect(statuses).toEqual([...Array<number>(20).fill(404), 429]);
      const limited = responses.find((r) => r.statusCode === 429);
      expect(limited?.json()).toEqual({ errorCode: 'common.error.rate-limited', params: {} });
      expect(lookups).toHaveBeenCalledTimes(20);

      // Negative cache: the same unknown id is looked up once per second, not per request.
      lookups.mockClear();
      const unknown = ulid();
      const otherId = await createUser(ctx.db);
      for (let i = 0; i < 3; i += 1) expect((await say(unknown, otherId)).statusCode).toBe(404);
      expect(lookups).toHaveBeenCalledTimes(1);
      lookups.mockRestore();
    });
  });

  describe('vendor moderation', () => {
    it('deletes a message of its own session (chat.deleted); vendor B gets 404', async () => {
      await createPlatformSettings(ctx, 0);
      const { sessionId } = await liveSession(ctx, vendor);
      const clientMessageId = ulid();
      const { id: messageId } = (await say(sessionId, customerId, 'spam', clientMessageId)).json<{
        id: string;
      }>();
      const other = await createVendor(ctx.db);
      const url = `/vendor/live-sessions/${sessionId}/messages/${messageId}/delete`;

      const foreign = await post(url, other.ownerId);
      expect(foreign.statusCode).toBe(404);
      expect(foreign.json()).toEqual({ errorCode: 'live.error.not-found', params: {} });
      expect(await ctx.redis.xlen(liveKeys.chat(sessionId))).toBe(1);

      expect((await post(url, customerId)).statusCode).toBe(403);
      expect((await post(url, null)).statusCode).toBe(401);

      const staffId = await addVendorStaff(ctx.db, vendor.vendorId);
      expect((await post(url, staffId)).statusCode).toBe(204);
      expect(await ctx.redis.xlen(liveKeys.chat(sessionId))).toBe(0);
      expect((await post(url, vendor.ownerId)).statusCode).toBe(204); // idempotent

      // A client retry of the deleted message neither replays nor re-posts it.
      const retry = await say(sessionId, customerId, 'spam', clientMessageId);
      expect(retry.statusCode).toBe(409);
      expect(retry.json()).toEqual({ errorCode: 'common.error.conflict', params: {} });
      expect(await ctx.redis.xlen(liveKeys.chat(sessionId))).toBe(0);

      const deleted = (await capture.forSession(sessionId)).filter(
        (e) => e.type === 'chat.deleted',
      );
      expect(deleted).toEqual([{ type: 'chat.deleted', sessionId, messageId }]);

      const malformed = await post(
        `/vendor/live-sessions/${sessionId}/messages/abc/delete`,
        vendor.ownerId,
      );
      expect(malformed.statusCode).toBe(404);
    });

    it('mute: own sessions only; body validated; vendor B 404; keys always expire', async () => {
      const { sessionId, owner } = await scheduledSession(ctx, vendor);
      const other = await createVendor(ctx.db);
      const mutes = `/vendor/live-sessions/${sessionId}/mutes`;

      expect((await post(mutes, other.ownerId, { userId: customerId })).statusCode).toBe(404);
      expect((await post(mutes, vendor.ownerId, { userId: 'nope' })).statusCode).toBe(422);
      expect((await post(mutes, vendor.ownerId, { userId: customerId })).statusCode).toBe(204);
      expect(await ctx.redis.sismember(liveKeys.muted(sessionId), customerId)).toBe(1);
      expect(await ctx.redis.ttl(liveKeys.muted(sessionId))).toBeGreaterThan(86_000);
      expect((await post(`${mutes}/nope/unmute`, vendor.ownerId)).statusCode).toBe(422);

      // A write after the end (racing its EXPIRE) still gets a TTL.
      await ctx.service.cancel(owner, sessionId);
      await ctx.redis.del(liveKeys.muted(sessionId));
      expect((await post(mutes, vendor.ownerId, { userId: ulid() })).statusCode).toBe(204);
      expect(await ctx.redis.ttl(liveKeys.muted(sessionId))).toBeGreaterThan(86_000);
    });
  });

  describe('POST /live-sessions/:id/reactions', () => {
    const react = (sessionId: string, userId: string | null, kind = 'HEART') =>
      post(`/live-sessions/${sessionId}/reactions`, userId, { kind });

    it('202; reactions from several users aggregate into one burst', async () => {
      const { sessionId } = await liveSession(ctx, vendor);
      const otherId = await createUser(ctx.db);

      const results = await Promise.all([
        react(sessionId, customerId),
        react(sessionId, customerId),
        react(sessionId, otherId),
        react(sessionId, otherId, 'WOW'),
      ]);
      expect(results.map((r) => r.statusCode)).toEqual([202, 202, 202, 202]);

      const bursts = (await capture.forSession(sessionId, 400)).filter(
        (e) => e.type === 'reaction.burst',
      );
      expect(bursts).toEqual([{ type: 'reaction.burst', sessionId, counts: { HEART: 3, WOW: 1 } }]);
    });

    it('guest 401; not live 409; bad kind 422; > 10/s per user 429', async () => {
      const scheduled = await scheduledSession(ctx, vendor);
      expect((await react(scheduled.sessionId, null)).statusCode).toBe(401);
      const notLive = await react(scheduled.sessionId, customerId);
      expect(notLive.statusCode).toBe(409);
      expect(notLive.json()).toEqual({ errorCode: 'live.error.not-live', params: {} });

      const { sessionId } = await liveSession(ctx, vendor);
      expect((await react(sessionId, customerId, 'ANGRY')).statusCode).toBe(422);

      // One token, fired together, so all 11 land in the same 1 s window.
      const headers = await ctx.authHeader(customerId);
      const burst = await Promise.all(
        Array.from({ length: 11 }, () =>
          ctx.app.inject({
            method: 'POST',
            url: `/v1/live-sessions/${sessionId}/reactions`,
            headers,
            payload: { kind: 'LIKE' },
          }),
        ),
      );
      const statuses = burst.map((r) => r.statusCode).sort();
      expect(statuses).toEqual([...Array<number>(10).fill(202), 429]);
      // Another user has their own budget.
      expect((await react(sessionId, await createUser(ctx.db))).statusCode).toBe(202);
    });
  });
});
