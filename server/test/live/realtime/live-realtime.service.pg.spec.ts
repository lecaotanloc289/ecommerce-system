import { Logger } from '@nestjs/common';
import type { LiveEvent } from '@repo/core';
import Redis from 'ioredis';
import { ulid } from 'ulid';
import { LiveRealtimeService } from '../../../src/live/realtime/live-realtime.service';

/**
 * The per-instance subscriber over a real Redis (pg harness container). Two services = two
 * API instances, each with its own subscriber connection.
 */
describe('LiveRealtimeService', () => {
  let base: Redis;
  let publisher: Redis;
  let a: LiveRealtimeService;
  let b: LiveRealtimeService;

  beforeAll(() => {
    Logger.overrideLogger(false); // dropped-message warnings are expected here
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL not set');
    base = new Redis(url);
    publisher = new Redis(url);
  });

  beforeEach(() => {
    a = new LiveRealtimeService(base);
    b = new LiveRealtimeService(base);
  });

  afterEach(async () => {
    await a.onModuleDestroy();
    await b.onModuleDestroy();
  });

  afterAll(async () => {
    await base.quit();
    await publisher.quit();
  });

  function collect(events: { subscribe(next: (event: LiveEvent) => void): unknown }) {
    const received: LiveEvent[] = [];
    events.subscribe((event) => received.push(event));
    return received;
  }

  /** Channel subscribers only (PUBLISH counts would include other test files' PSUBSCRIBEs). */
  async function channelSubscribers(channel: string): Promise<number> {
    const [, count] = await publisher.pubsub('NUMSUB', channel);
    return Number(count);
  }

  const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

  it('two instances on separate connections both receive one publish', async () => {
    const sessionId = ulid();
    const onA = collect((await a.join(sessionId)).events);
    const onB = collect((await b.join(sessionId)).events);

    const event = { type: 'session.cancelled', sessionId };
    await publisher.publish(`live:${sessionId}:events`, JSON.stringify(event));
    await settle();

    expect(onA).toEqual([event]);
    expect(onB).toEqual([event]);
  });

  it('fans out to every local listener of a session; other sessions are not delivered', async () => {
    const sessionId = ulid();
    const other = ulid();
    const first = collect((await a.join(sessionId)).events);
    const second = collect((await a.join(sessionId)).events);
    expect(a.localSessionCount()).toBe(1);

    await publisher.publish(
      `live:${other}:events`,
      JSON.stringify({ type: 'session.cancelled', sessionId: other }),
    );
    await publisher.publish(
      `live:${sessionId}:events`,
      JSON.stringify({ type: 'viewers.updated', sessionId, count: 3 }),
    );
    await settle();

    expect(first).toEqual([{ type: 'viewers.updated', sessionId, count: 3 }]);
    expect(second).toEqual(first);
  });

  it('drops non-JSON, invalid and cross-session messages', async () => {
    const sessionId = ulid();
    const received = collect((await a.join(sessionId)).events);
    const channel = `live:${sessionId}:events`;

    await publisher.publish(channel, 'not json');
    await publisher.publish(
      channel,
      JSON.stringify({ type: 'viewers.updated', sessionId, count: -1 }),
    );
    await publisher.publish(channel, JSON.stringify({ type: 'bogus', sessionId }));
    await publisher.publish(
      channel,
      JSON.stringify({ type: 'session.cancelled', sessionId: ulid() }),
    );
    await publisher.publish(channel, JSON.stringify({ type: 'recording.ready', sessionId }));
    await settle();

    expect(received).toEqual([{ type: 'recording.ready', sessionId }]);
  });

  it('the last leave unsubscribes; a later join subscribes again', async () => {
    const sessionId = ulid();
    const channel = `live:${sessionId}:events`;
    const first = await a.join(sessionId);
    const second = await a.join(sessionId);

    first.leave();
    first.leave(); // idempotent — must not release the second listener's reference
    await settle(50);
    expect(await channelSubscribers(channel)).toBe(1);
    expect(a.localSessionCount()).toBe(1);

    second.leave();
    expect(a.localSessionCount()).toBe(0);
    await settle(50);
    expect(await channelSubscribers(channel)).toBe(0);

    const again = collect((await a.join(sessionId)).events);
    await publisher.publish(channel, JSON.stringify({ type: 'recording.ready', sessionId }));
    await settle();
    expect(again).toEqual([{ type: 'recording.ready', sessionId }]);
  });
});
