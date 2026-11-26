import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ulid } from 'ulid';
import { LiveEventsPublisher } from '../../../src/live/live-events.publisher';
import { DEFAULT_LIVE_REALTIME_OPTIONS } from '../../../src/live/realtime/live-realtime.options';
import { LiveViewersService } from '../../../src/live/realtime/live-viewers.service';

/** Unit: Redis failures must not leave local viewer state (and a ticker) behind. */
describe('LiveViewersService with a failing Redis', () => {
  let redis: Redis;
  let viewers: LiveViewersService;

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(() => {
    // Never connects; with the offline queue off every command rejects immediately.
    redis = new Redis({ port: 1, lazyConnect: true, enableOfflineQueue: false });
    viewers = new LiveViewersService(redis, new LiveEventsPublisher(redis), {
      ...DEFAULT_LIVE_REALTIME_OPTIONS,
      viewerTickMs: 10,
    });
  });

  afterEach(() => {
    viewers.onModuleDestroy();
    redis.disconnect();
  });

  it('connect() rejects and undoes the local registration (no orphan ticker)', async () => {
    const sessionId = ulid();
    await expect(viewers.connect(sessionId)).rejects.toThrow();
    expect(viewers.localSessionCount()).toBe(0);

    // Two concurrent failures on the same session also leave nothing behind.
    await Promise.allSettled([viewers.connect(sessionId), viewers.connect(sessionId)]);
    expect(viewers.localSessionCount()).toBe(0);
  });

  it('tick() swallows Redis errors', async () => {
    await expect(viewers.tick(ulid())).resolves.toBeUndefined();
  });
});
