import type { AddressInfo } from 'node:net';
import { ulid } from 'ulid';
import { LiveRealtimeService } from '../../../src/live/realtime/live-realtime.service';
import { LiveSseService } from '../../../src/live/realtime/live-sse.service';
import { liveKeys } from '../../../src/live/live-redis-keys';
import { createVendor, resetDatabase, resetRedis, type TestVendor } from '../../integration/pg';
import { createLiveTestApp, type LiveTestApp, vendorUser } from '../live-test-app';
import { eventsOf, eventually, liveSession, openSse, scheduledSession } from './realtime-helpers';

const WEB_ORIGIN = 'http://localhost:3000';

/**
 * SSE over a real listening Fastify app (`listen(0)` + streaming `fetch`), real Redis/Postgres.
 * Timers are shortened (ping 100 ms, viewer tick 150 ms, status re-check every 2nd ping) and
 * the per-IP stream cap is 3.
 */
describe('GET /live-sessions/:id/events (SSE)', () => {
  let ctx: LiveTestApp;
  let baseUrl: string;
  let vendor: TestVendor;
  const streams: { close(): void }[] = [];

  beforeAll(async () => {
    ctx = await createLiveTestApp({
      corsOrigin: WEB_ORIGIN,
      realtime: {
        pingIntervalMs: 100,
        viewerTickMs: 150,
        maxSseConnectionsPerIp: 3,
        sseStatusRecheckEveryPings: 2,
      },
    });
    await ctx.app.listen(0, '127.0.0.1');
    const address = ctx.app.getHttpServer().address();
    if (address === null || typeof address === 'string') throw new Error('no TCP address');
    baseUrl = `http://127.0.0.1:${(address satisfies AddressInfo).port}/v1`;
  });

  afterAll(() => ctx?.app.close());

  beforeEach(async () => {
    await resetDatabase(ctx.db);
    await resetRedis(ctx.redis);
    vendor = await createVendor(ctx.db);
  });

  afterEach(async () => {
    for (const stream of streams.splice(0)) stream.close();
    // Slots are freed when the server sees the disconnect; don't let the next test hit the cap.
    await eventually(async () => ctx.app.get(LiveSseService).openStreamCount() === 0);
  });

  async function open(sessionId: string, headers: Record<string, string> = {}) {
    const stream = await openSse(`${baseUrl}/live-sessions/${sessionId}/events`, headers);
    streams.push(stream);
    return stream;
  }

  it('streams with SSE + CORS headers, a ping, and a pinned-product event', async () => {
    const { sessionId, productId, owner } = await scheduledSession(ctx, vendor);
    const stream = await open(sessionId, { origin: WEB_ORIGIN });

    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(stream.response.headers.get('cache-control')).toBe('no-cache');
    expect(stream.response.headers.get('x-accel-buffering')).toBe('no');
    expect(stream.response.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(stream.response.headers.get('access-control-allow-credentials')).toBe('true');

    await stream.waitFor((frames) => frames.some((frame) => frame.comment === 'connected'));
    await ctx.service.pinProduct(owner, sessionId, productId);

    const frames = await stream.waitFor(
      (all) =>
        eventsOf(all, 'product.pinned').length === 1 && all.some((f) => f.comment === 'ping'),
    );
    expect(eventsOf(frames, 'product.pinned')).toEqual([
      { type: 'product.pinned', sessionId, productId, pinnedAt: expect.any(String) },
    ]);
  });

  it('404 for unknown, cancelled and ended sessions; malformed id → 404', async () => {
    const unknown = await fetch(`${baseUrl}/live-sessions/${ulid()}/events`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ errorCode: 'live.error.not-found', params: {} });

    expect((await fetch(`${baseUrl}/live-sessions/not-an-id/events`)).status).toBe(404);

    const cancelled = await scheduledSession(ctx, vendor);
    await ctx.service.cancel(cancelled.owner, cancelled.sessionId);
    expect((await fetch(`${baseUrl}/live-sessions/${cancelled.sessionId}/events`)).status).toBe(
      404,
    );

    const ended = await liveSession(ctx, vendor);
    await ctx.service.end(ended.owner, ended.sessionId);
    expect((await fetch(`${baseUrl}/live-sessions/${ended.sessionId}/events`)).status).toBe(404);
  });

  it('viewer count rises and falls with connections; peak is kept', async () => {
    const { sessionId } = await liveSession(ctx, vendor);
    const first = await open(sessionId);
    const second = await open(sessionId);

    const counts = (frames: Parameters<typeof eventsOf>[0]) =>
      eventsOf(frames, 'viewers.updated').map((event) =>
        typeof event === 'object' && event !== null && 'count' in event ? event.count : null,
      );
    await first.waitFor((frames) => counts(frames).includes(2));
    expect(await ctx.redis.zcard(liveKeys.viewers(sessionId))).toBe(2);

    second.close();
    await first.waitFor((frames) => counts(frames).at(-1) === 1);
    expect(await ctx.redis.zcard(liveKeys.viewers(sessionId))).toBe(1);
    expect(await ctx.redis.get(liveKeys.peak(sessionId))).toBe('2');
    expect(await ctx.redis.ttl(liveKeys.peak(sessionId))).toBeGreaterThan(86_000);
    expect(await ctx.redis.ttl(liveKeys.viewers(sessionId))).toBeGreaterThan(86_000);

    first.close();
    await eventually(async () => (await ctx.redis.zcard(liveKeys.viewers(sessionId))) === 0);
    await eventually(async () => ctx.app.get(LiveRealtimeService).localSessionCount() === 0);
  });

  it('forwards session.ended, then closes the stream', async () => {
    const { sessionId, owner } = await liveSession(ctx, vendor);
    const stream = await open(sessionId);
    await stream.waitFor((frames) => frames.some((frame) => frame.comment === 'connected'));

    await ctx.service.end(vendorUser(owner.id, vendor.vendorId), sessionId);

    await stream.waitForEnd();
    expect(eventsOf(stream.frames(), 'session.ended')).toEqual([
      { type: 'session.ended', sessionId, endedAt: expect.any(String), endReason: 'VENDOR' },
    ]);
    await eventually(async () => (await ctx.redis.zcard(liveKeys.viewers(sessionId))) === 0);
  });

  it('caps concurrent streams per client IP (429 before any lookup), freeing slots on close', async () => {
    const { sessionId } = await liveSession(ctx, vendor);
    const sse = ctx.app.get(LiveSseService);
    const open3 = [await open(sessionId), await open(sessionId), await open(sessionId)];
    expect(sse.openStreamCount()).toBe(3);

    const over = await fetch(`${baseUrl}/live-sessions/${sessionId}/events`);
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ errorCode: 'common.error.rate-limited', params: {} });
    // Rejected before the status lookup: even an unknown session gets 429, not 404.
    expect((await fetch(`${baseUrl}/live-sessions/${ulid()}/events`)).status).toBe(429);

    open3[0]?.close();
    await eventually(async () => sse.openStreamCount() === 2);
    const again = await open(sessionId);
    expect(again.response.status).toBe(200);
    // Failed attempts (404) do not leak slots.
    open3[1]?.close();
    await eventually(async () => sse.openStreamCount() === 2);
    expect((await fetch(`${baseUrl}/live-sessions/${ulid()}/events`)).status).toBe(404);
    expect(sse.openStreamCount()).toBe(2);
  });

  it('closes the stream when a periodic status re-check finds the session over', async () => {
    const { sessionId } = await liveSession(ctx, vendor);
    const stream = await open(sessionId);
    await stream.waitFor((frames) => frames.some((frame) => frame.comment === 'connected'));

    // Ended without any event reaching this client (e.g. a lost publish).
    await ctx.db.liveSession.update({
      where: { id: sessionId },
      data: { status: 'ENDED', endedAt: new Date(), endReason: 'VENDOR' },
    });
    await stream.waitForEnd();
    expect(eventsOf(stream.frames(), 'session.ended')).toEqual([]);
    await eventually(async () => (await ctx.redis.zcard(liveKeys.viewers(sessionId))) === 0);
    await eventually(async () => ctx.app.get(LiveSseService).openStreamCount() === 0);
  });
});
