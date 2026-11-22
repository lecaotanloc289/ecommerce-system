import { type CreateLiveSession, type ProductId, ProductIdSchema } from '@repo/core';
import { ulid } from 'ulid';
import type { AuthUser } from '../../src/auth/auth.schemas';
import {
  addVendorStaff,
  createProduct,
  createVendor,
  resetDatabase,
  resetRedis,
} from '../integration/pg';
import {
  captureLiveEvents,
  createLiveTestApp,
  type LiveTestApp,
  outboxEventTypes,
  provision,
  vendorUser,
} from './live-test-app';

/** LiveSessionService against real Postgres (migrated schema + partial indexes) and Redis. */
describe('LiveSessionService (Postgres + Redis)', () => {
  let ctx: LiveTestApp;
  let events: Awaited<ReturnType<typeof captureLiveEvents>>;
  let owner: AuthUser;
  let vendorId: string;
  let productA: ProductId;
  let productB: ProductId;
  let productC: ProductId;

  beforeAll(async () => {
    ctx = await createLiveTestApp();
    events = await captureLiveEvents(ctx.env.REDIS_URL);
  });

  afterAll(async () => {
    await events?.close();
    await ctx?.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.db);
    await resetRedis(ctx.redis);
    const vendor = await createVendor(ctx.db);
    vendorId = vendor.vendorId;
    owner = vendorUser(vendor.ownerId, vendorId);
    productA = await createProduct(ctx.db, vendorId);
    productB = await createProduct(ctx.db, vendorId);
    productC = await createProduct(ctx.db, vendorId);
  });

  function input(overrides: Partial<CreateLiveSession> = {}): CreateLiveSession {
    return { title: 'Evening deals', scheduledAt: null, productIds: [], ...overrides };
  }

  async function createSession(user: AuthUser = owner, productIds: ProductId[] = [productA]) {
    const { session } = await ctx.service.create(
      user,
      ulid(),
      input({ productIds: [...productIds] }),
    );
    return session;
  }

  /** SCHEDULED → provisioned → encoder connected → LIVE. */
  async function liveSession(user: AuthUser = owner, productIds: ProductId[] = [productA]) {
    const session = await createSession(user, productIds);
    const liveInputId = await provision(ctx, session.id);
    await ctx.service.applyEncoderEvent({ liveInputId, isConnected: true, occurredAt: new Date() });
    await ctx.service.goLive(user, session.id);
    return { session, liveInputId };
  }

  describe('create', () => {
    it('creates a SCHEDULED session with its line-up and a provision_requested outbox row', async () => {
      const scheduledAt = '2026-12-01T12:00:00.000Z';
      const { session, isCreated } = await ctx.service.create(
        owner,
        ulid(),
        input({ title: 'Evening deals', scheduledAt, productIds: [productB, productA] }),
      );

      expect(isCreated).toBe(true);
      expect(session).toMatchObject({
        vendorId,
        title: 'Evening deals',
        status: 'SCHEDULED',
        scheduledAt,
        playback: null,
        isProvisioned: false,
        isEncoderConnected: false,
        products: [
          { productId: productB, position: 0, pinnedAt: null },
          { productId: productA, position: 1, pinnedAt: null },
        ],
      });
      const outbox = await ctx.db.outboxEvent.findMany({ where: { aggregateId: session.id } });
      expect(outbox).toEqual([
        expect.objectContaining({
          aggregateType: 'LiveSession',
          eventType: 'live_session.provision_requested',
          payload: { liveSessionId: session.id },
          processedAt: null,
        }),
      ]);
    });

    it('replays the same Idempotency-Key for the same vendor without writing again', async () => {
      const key = ulid();
      const first = await ctx.service.create(owner, key, input({ productIds: [productA] }));
      const replay = await ctx.service.create(owner, key, input({ productIds: [productA] }));

      expect(replay.isCreated).toBe(false);
      expect(replay.session).toEqual(first.session);
      await expect(ctx.db.liveSession.count()).resolves.toBe(1);
      await expect(ctx.db.outboxEvent.count()).resolves.toBe(1);
    });

    it('rejects a replay of the same key with a different payload (key-reused)', async () => {
      const key = ulid();
      const scheduledAt = '2027-01-01T12:00:00.000Z';
      await ctx.service.create(owner, key, input({ productIds: [productA], scheduledAt }));

      // Same instant written with an offset is the same request.
      const sameInstant = await ctx.service.create(
        owner,
        key,
        input({ productIds: [productA], scheduledAt: '2027-01-01T19:00:00+07:00' }),
      );
      expect(sameInstant.isCreated).toBe(false);

      for (const changed of [
        input({ productIds: [productA], scheduledAt, title: 'Different title' }),
        input({ productIds: [productA], scheduledAt: null }),
        input({ productIds: [], scheduledAt }),
      ]) {
        await expect(ctx.service.create(owner, key, changed)).rejects.toMatchObject({
          code: 'idempotency.error.key-reused',
        });
      }
      await expect(ctx.db.liveSession.count()).resolves.toBe(1);
    });

    it('scopes Idempotency-Keys per vendor', async () => {
      const other = await createVendor(ctx.db);
      const key = ulid();
      const mine = await ctx.service.create(owner, key, input());
      const theirs = await ctx.service.create(
        vendorUser(other.ownerId, other.vendorId),
        key,
        input(),
      );
      expect(theirs.isCreated).toBe(true);
      expect(theirs.session.id).not.toBe(mine.session.id);
    });

    it('requires a ULID Idempotency-Key', async () => {
      await expect(ctx.service.create(owner, undefined, input())).rejects.toMatchObject({
        code: 'idempotency.error.key-required',
      });
      await expect(ctx.service.create(owner, 'not-a-ulid', input())).rejects.toMatchObject({
        code: 'idempotency.error.key-required',
      });
    });

    it('rejects another vendor’s product and writes nothing', async () => {
      const other = await createVendor(ctx.db);
      const foreign = await createProduct(ctx.db, other.vendorId);
      await expect(
        ctx.service.create(owner, ulid(), input({ productIds: [productA, foreign] })),
      ).rejects.toMatchObject({
        code: 'live.error.product-not-owned',
        params: { productId: foreign },
      });
      await expect(ctx.db.liveSession.count()).resolves.toBe(0);
      await expect(ctx.db.outboxEvent.count()).resolves.toBe(0);
    });

    it('rejects an unknown product as not owned', async () => {
      await expect(
        ctx.service.create(owner, ulid(), input({ productIds: [ProductIdSchema.parse(ulid())] })),
      ).rejects.toMatchObject({ code: 'live.error.product-not-owned' });
    });

    it('rejects an inactive product', async () => {
      const draft = await createProduct(ctx.db, vendorId, 'DRAFT');
      await expect(
        ctx.service.create(owner, ulid(), input({ productIds: [draft] })),
      ).rejects.toMatchObject({
        code: 'live.error.product-inactive',
        params: { productId: draft },
      });
      await expect(ctx.db.liveSession.count()).resolves.toBe(0);
    });

    it('re-checks the vendor in the DB: suspended vendor or revoked role → vendor.error.not-active', async () => {
      await ctx.db.vendor.update({ where: { id: vendorId }, data: { status: 'SUSPENDED' } });
      await expect(ctx.service.create(owner, ulid(), input())).rejects.toMatchObject({
        code: 'vendor.error.not-active',
      });

      const other = await createVendor(ctx.db);
      await ctx.db.userRole.deleteMany({
        where: { userId: other.ownerId, vendorId: other.vendorId },
      });
      await expect(
        ctx.service.create(vendorUser(other.ownerId, other.vendorId), ulid(), input()),
      ).rejects.toMatchObject({ code: 'vendor.error.not-active' });

      const noVendor = vendorUser(other.ownerId, other.vendorId);
      await expect(
        ctx.service.create({ id: noVendor.id, roles: noVendor.roles }, ulid(), input()),
      ).rejects.toMatchObject({ code: 'vendor.error.not-active' });
    });

    it('lets vendor staff create for their vendor', async () => {
      const staffId = await addVendorStaff(ctx.db, vendorId);
      const { session } = await ctx.service.create(
        vendorUser(staffId, vendorId, 'VENDOR_STAFF'),
        ulid(),
        input(),
      );
      expect(session.vendorId).toBe(vendorId);
    });
  });

  describe('state machine', () => {
    it('go-live needs a provisioned input, then a connected encoder', async () => {
      const session = await createSession();
      await expect(ctx.service.goLive(owner, session.id)).rejects.toMatchObject({
        code: 'live.error.not-provisioned',
      });
      const liveInputId = await provision(ctx, session.id);
      await expect(ctx.service.goLive(owner, session.id)).rejects.toMatchObject({
        code: 'live.error.encoder-offline',
      });
      expect(await outboxEventTypes(ctx, session.id)).toEqual(['live_session.provision_requested']);

      await ctx.service.applyEncoderEvent({
        liveInputId,
        isConnected: true,
        occurredAt: new Date(),
      });
      const live = await ctx.service.goLive(owner, session.id);
      expect(live).toMatchObject({
        status: 'LIVE',
        isProvisioned: true,
        isEncoderConnected: true,
        playback: ctx.stream.livePlayback(liveInputId),
      });
      expect(live.startedAt).not.toBeNull();

      const outbox = await ctx.db.outboxEvent.findMany({
        where: { aggregateId: session.id, eventType: 'live_session.started' },
      });
      expect(outbox.map((row) => row.payload)).toEqual([
        { liveSessionId: session.id, vendorId, startedAt: live.startedAt },
      ]);
      expect(await events.forSession(session.id)).toContainEqual({
        type: 'session.live',
        sessionId: session.id,
        startedAt: live.startedAt,
      });
    });

    it('go-live is idempotent: a repeat returns the LIVE session without a second outbox row', async () => {
      const { session } = await liveSession();
      const again = await ctx.service.goLive(owner, session.id);
      expect(again.status).toBe('LIVE');
      expect(await outboxEventTypes(ctx, session.id)).toEqual([
        'live_session.provision_requested',
        'live_session.started',
      ]);
    });

    it('a second LIVE session for the same vendor → live.error.already-live (nothing written)', async () => {
      await liveSession();
      const second = await createSession(owner, [productB]);
      const liveInputId = await provision(ctx, second.id);
      await ctx.service.applyEncoderEvent({
        liveInputId,
        isConnected: true,
        occurredAt: new Date(),
      });

      await expect(ctx.service.goLive(owner, second.id)).rejects.toMatchObject({
        code: 'live.error.already-live',
      });
      const row = await ctx.db.liveSession.findUniqueOrThrow({ where: { id: second.id } });
      expect(row.status).toBe('SCHEDULED');
      expect(await outboxEventTypes(ctx, second.id)).toEqual(['live_session.provision_requested']);
    });

    it('cancel: SCHEDULED → CANCELLED once; LIVE cannot be cancelled; CANCELLED cannot go live', async () => {
      const session = await createSession();
      const liveInputId = await provision(ctx, session.id);
      const cancelled = await ctx.service.cancel(owner, session.id);
      expect(cancelled.status).toBe('CANCELLED');
      await expect(ctx.service.cancel(owner, session.id)).resolves.toMatchObject({
        status: 'CANCELLED',
      });
      const outbox = await ctx.db.outboxEvent.findMany({
        where: { aggregateId: session.id, eventType: 'live_session.cancelled' },
      });
      expect(outbox.map((row) => row.payload)).toEqual([
        { liveSessionId: session.id, liveInputId },
      ]);
      expect(await events.forSession(session.id)).toContainEqual({
        type: 'session.cancelled',
        sessionId: session.id,
      });

      await expect(ctx.service.goLive(owner, session.id)).rejects.toMatchObject({
        code: 'live.error.invalid-transition',
      });
      await expect(ctx.service.end(owner, session.id)).rejects.toMatchObject({
        code: 'live.error.invalid-transition',
      });

      const { session: live } = await liveSession(owner, [productB]);
      await expect(ctx.service.cancel(owner, live.id)).rejects.toMatchObject({
        code: 'live.error.invalid-transition',
      });
      expect(await outboxEventTypes(ctx, live.id)).not.toContain('live_session.cancelled');
    });

    it('end: LIVE → ENDED (VENDOR), copies the Redis peak, expires realtime keys, idempotent', async () => {
      const { session, liveInputId } = await liveSession();
      await ctx.redis.set(`live:${session.id}:peak`, '42');
      await ctx.redis.sadd(`live:${session.id}:muted`, 'someone');

      const ended = await ctx.service.end(owner, session.id);
      expect(ended).toMatchObject({
        status: 'ENDED',
        endReason: 'VENDOR',
        endNote: null,
        peakViewers: 42,
        playback: null, // no recording yet
      });
      expect(ended.endedAt).not.toBeNull();
      await expect(ctx.redis.ttl(`live:${session.id}:peak`)).resolves.toBeGreaterThan(86_000);
      await expect(ctx.redis.ttl(`live:${session.id}:muted`)).resolves.toBeGreaterThan(86_000);

      const outbox = await ctx.db.outboxEvent.findMany({
        where: { aggregateId: session.id, eventType: 'live_session.ended' },
      });
      expect(outbox.map((row) => row.payload)).toEqual([
        { liveSessionId: session.id, vendorId, liveInputId, endReason: 'VENDOR' },
      ]);
      expect(await events.forSession(session.id)).toContainEqual({
        type: 'session.ended',
        sessionId: session.id,
        endedAt: ended.endedAt,
        endReason: 'VENDOR',
      });

      const again = await ctx.service.end(owner, session.id);
      expect(again).toEqual(ended);
      expect(
        (await outboxEventTypes(ctx, session.id)).filter((t) => t === 'live_session.ended'),
      ).toHaveLength(1);
    });

    it('end of a SCHEDULED session is an invalid transition and writes no outbox row', async () => {
      const session = await createSession();
      await expect(ctx.service.end(owner, session.id)).rejects.toMatchObject({
        code: 'live.error.invalid-transition',
      });
      expect(await outboxEventTypes(ctx, session.id)).toEqual(['live_session.provision_requested']);
    });

    it('terminate: LIVE → ENDED (TERMINATED) with the reason as endNote', async () => {
      const { session } = await liveSession();
      const terminated = await ctx.service.terminate(session.id, 'Policy violation');
      expect(terminated).toMatchObject({
        status: 'ENDED',
        endReason: 'TERMINATED',
        endNote: 'Policy violation',
      });
      await expect(ctx.service.terminate(ulid(), 'Policy violation')).rejects.toMatchObject({
        code: 'live.error.not-found',
      });
    });
  });

  describe('Redis outage at the end', () => {
    it('vendor end and platform terminate still succeed when reading the Redis peak fails', async () => {
      const { session: ended } = await liveSession();
      await ctx.db.liveSession.update({ where: { id: ended.id }, data: { peakViewers: 7 } });
      const get = jest.spyOn(ctx.redis, 'get').mockRejectedValueOnce(new Error('redis down'));
      await expect(ctx.service.end(owner, ended.id)).resolves.toMatchObject({
        status: 'ENDED',
        endReason: 'VENDOR',
        peakViewers: 7,
      });

      const { session: terminated } = await liveSession(owner, [productB]);
      get.mockRejectedValueOnce(new Error('redis down'));
      await expect(ctx.service.terminate(terminated.id, 'policy breach')).resolves.toMatchObject({
        status: 'ENDED',
        endReason: 'TERMINATED',
        peakViewers: 0,
      });
      get.mockRestore();
    });
  });

  describe('encoder events', () => {
    it('clamps a far-future timestamp to now, so later real events still apply', async () => {
      const session = await createSession();
      const liveInputId = await provision(ctx, session.id);
      const before = Date.now();

      await expect(
        ctx.service.applyEncoderEvent({
          liveInputId,
          isConnected: true,
          occurredAt: new Date(before + 86_400_000),
        }),
      ).resolves.toBe('applied');
      const row = await ctx.db.liveSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(row.encoderStatusAt?.getTime()).toBeLessThanOrEqual(Date.now());
      expect(row.encoderStatusAt?.getTime()).toBeGreaterThanOrEqual(before);

      await expect(
        ctx.service.applyEncoderEvent({
          liveInputId,
          isConnected: false,
          occurredAt: new Date(Date.now() + 1_000),
        }),
      ).resolves.toBe('applied');
      // Within the allowed skew (60 s) the provider's timestamp is kept as-is.
      const nearFuture = new Date(Date.now() + 30_000);
      await ctx.service.applyEncoderEvent({
        liveInputId,
        isConnected: true,
        occurredAt: nearFuture,
      });
      await expect(
        ctx.db.liveSession.findUniqueOrThrow({ where: { id: session.id } }),
      ).resolves.toMatchObject({ encoderStatusAt: nearFuture });
    });

    it('ignores events older than the last applied one (out-of-order / replay)', async () => {
      const session = await createSession();
      const liveInputId = await provision(ctx, session.id);
      const t1 = new Date('2026-01-15T10:00:00.000Z');
      const t2 = new Date('2026-01-15T10:00:05.000Z');

      await expect(
        ctx.service.applyEncoderEvent({ liveInputId, isConnected: false, occurredAt: t1 }),
      ).resolves.toBe('applied');
      await expect(
        ctx.service.applyEncoderEvent({ liveInputId, isConnected: true, occurredAt: t2 }),
      ).resolves.toBe('applied');
      // Replay of the older disconnect after the newer connect.
      await expect(
        ctx.service.applyEncoderEvent({ liveInputId, isConnected: false, occurredAt: t1 }),
      ).resolves.toBe('stale');
      // Same timestamp is not newer either.
      await expect(
        ctx.service.applyEncoderEvent({ liveInputId, isConnected: false, occurredAt: t2 }),
      ).resolves.toBe('stale');

      const row = await ctx.db.liveSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(row).toMatchObject({
        encoderConnectedAt: t2,
        encoderDisconnectedAt: null,
        encoderStatusAt: t2,
      });
    });

    it('a disconnect while LIVE writes encoder_disconnected; while SCHEDULED it does not', async () => {
      const scheduled = await createSession(owner, [productB]);
      const scheduledInput = await provision(ctx, scheduled.id);
      await ctx.service.applyEncoderEvent({
        liveInputId: scheduledInput,
        isConnected: false,
        occurredAt: new Date(),
      });
      expect(await outboxEventTypes(ctx, scheduled.id)).toEqual([
        'live_session.provision_requested',
      ]);

      const { session, liveInputId } = await liveSession();
      const disconnectedAt = new Date(Date.now() + 1_000);
      await ctx.service.applyEncoderEvent({
        liveInputId,
        isConnected: false,
        occurredAt: disconnectedAt,
      });

      const outbox = await ctx.db.outboxEvent.findMany({
        where: { aggregateId: session.id, eventType: 'live_session.encoder_disconnected' },
      });
      expect(outbox.map((row) => row.payload)).toEqual([
        { liveSessionId: session.id, disconnectedAt: disconnectedAt.toISOString() },
      ]);
      const row = await ctx.db.liveSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(row).toMatchObject({
        status: 'LIVE',
        encoderConnectedAt: null,
        encoderDisconnectedAt: disconnectedAt,
      });
      expect(await events.forSession(session.id)).toContainEqual({
        type: 'encoder.status',
        sessionId: session.id,
        isConnected: false,
      });
    });

    it('ignores events for closed sessions and unknown inputs', async () => {
      const { session, liveInputId } = await liveSession();
      await ctx.service.end(owner, session.id);
      await expect(
        ctx.service.applyEncoderEvent({
          liveInputId,
          isConnected: false,
          occurredAt: new Date(Date.now() + 60_000),
        }),
      ).resolves.toBe('stale');
      await expect(
        ctx.service.applyEncoderEvent({
          liveInputId: 'unknown',
          isConnected: true,
          occurredAt: new Date(),
        }),
      ).resolves.toBe('unknown-input');
    });
  });

  describe('line-up and pinning', () => {
    it('replace keeps pinnedAt for products still present; pin swaps; unpin clears', async () => {
      const session = await createSession(owner, [productA, productB]);
      const pinned = await ctx.service.pinProduct(owner, session.id, productA);
      const pinnedAt = pinned.products.find((p) => p.productId === productA)?.pinnedAt;
      expect(pinnedAt).toEqual(expect.any(String));
      // Idempotent.
      await expect(ctx.service.pinProduct(owner, session.id, productA)).resolves.toEqual(pinned);

      const replaced = await ctx.service.replaceProducts(owner, session.id, {
        productIds: [productC, productA],
      });
      expect(replaced.products).toEqual([
        { productId: productC, position: 0, pinnedAt: null },
        { productId: productA, position: 1, pinnedAt },
      ]);

      const swapped = await ctx.service.pinProduct(owner, session.id, productC);
      expect(swapped.products.filter((p) => p.pinnedAt !== null).map((p) => p.productId)).toEqual([
        productC,
      ]);
      const unpinned = await ctx.service.unpinProduct(owner, session.id, productC);
      expect(unpinned.products.every((p) => p.pinnedAt === null)).toBe(true);

      const published = (await events.forSession(session.id)).map((e) => e.type);
      expect(published).toEqual([
        'product.pinned',
        'products.updated',
        'product.pinned',
        'product.unpinned',
      ]);
    });

    it('a product outside the line-up cannot be pinned', async () => {
      const session = await createSession(owner, [productA]);
      await expect(ctx.service.pinProduct(owner, session.id, productB)).rejects.toMatchObject({
        code: 'product.error.not-found',
      });
    });

    it('line-up edits are refused once the session is closed', async () => {
      const session = await createSession();
      await ctx.service.cancel(owner, session.id);
      await expect(
        ctx.service.replaceProducts(owner, session.id, { productIds: [productB] }),
      ).rejects.toMatchObject({ code: 'live.error.invalid-transition' });
      await expect(ctx.service.pinProduct(owner, session.id, productA)).rejects.toMatchObject({
        code: 'live.error.invalid-transition',
      });
    });
  });

  describe('ownership', () => {
    it('vendor B gets 404 on vendor A’s session and cannot use A’s products', async () => {
      const b = await createVendor(ctx.db);
      const vendorB = vendorUser(b.ownerId, b.vendorId);
      const sessionA = await createSession(owner, [productA]);

      for (const call of [
        () => ctx.service.getForVendor(vendorB, sessionA.id),
        () => ctx.service.getIngestCredentials(vendorB, sessionA.id),
        () => ctx.service.pinProduct(vendorB, sessionA.id, productA),
        () => ctx.service.replaceProducts(vendorB, sessionA.id, { productIds: [] }),
        () => ctx.service.goLive(vendorB, sessionA.id),
        () => ctx.service.end(vendorB, sessionA.id),
        () => ctx.service.cancel(vendorB, sessionA.id),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: 'live.error.not-found' });
      }
      await expect(ctx.service.listForVendor(vendorB)).resolves.toEqual([]);

      const sessionB = await createSession(vendorB, []);
      await expect(ctx.service.pinProduct(vendorB, sessionB.id, productA)).rejects.toMatchObject({
        code: 'product.error.not-found',
      });
      await expect(
        ctx.service.replaceProducts(vendorB, sessionB.id, { productIds: [productA] }),
      ).rejects.toMatchObject({ code: 'live.error.product-not-owned' });

      const stillA = await ctx.db.liveSession.findUniqueOrThrow({ where: { id: sessionA.id } });
      expect(stillA.status).toBe('SCHEDULED');
    });
  });

  describe('ingest credentials', () => {
    it('needs a provisioned open session; provider failure → stream-provider-unavailable', async () => {
      const session = await createSession();
      await expect(ctx.service.getIngestCredentials(owner, session.id)).rejects.toMatchObject({
        code: 'live.error.not-provisioned',
      });
      const liveInputId = await provision(ctx, session.id);
      await expect(ctx.service.getIngestCredentials(owner, session.id)).resolves.toEqual({
        rtmpsUrl: 'rtmps://live.fake.invalid:443/live/',
        streamKey: `fake-key-${liveInputId}`,
      });

      await ctx.stream.retireLiveInput(liveInputId); // fake now 404s
      await expect(ctx.service.getIngestCredentials(owner, session.id)).rejects.toMatchObject({
        code: 'live.error.stream-provider-unavailable',
      });

      await ctx.service.cancel(owner, session.id);
      await expect(ctx.service.getIngestCredentials(owner, session.id)).rejects.toMatchObject({
        code: 'live.error.invalid-transition',
      });
    });
  });

  describe('public reads and recordings', () => {
    it('lists LIVE by default, ENDED only with a recording, never CANCELLED', async () => {
      const { session: live, liveInputId } = await liveSession(owner, [productA]);
      const scheduled = await createSession(owner, [productB]);
      const cancelled = await createSession(owner, [productC]);
      await ctx.service.cancel(owner, cancelled.id);

      await expect(ctx.service.listPublic()).resolves.toEqual([
        expect.objectContaining({ id: live.id, status: 'LIVE' }),
      ]);
      const upcoming = await ctx.service.listPublic('SCHEDULED');
      expect(upcoming.map((s) => s.id)).toEqual([scheduled.id]);
      expect(upcoming[0]).not.toHaveProperty('isProvisioned');
      await expect(ctx.service.listPublic('CANCELLED')).rejects.toMatchObject({
        code: 'common.error.validation-failed',
      });
      await expect(ctx.service.getPublic(cancelled.id)).rejects.toMatchObject({
        code: 'live.error.not-found',
      });

      await ctx.service.end(owner, live.id);
      await expect(ctx.service.listPublic('ENDED')).resolves.toEqual([]);

      await expect(ctx.service.attachRecording(liveInputId, 'video123')).resolves.toBe(true);
      // First recording wins.
      await expect(ctx.service.attachRecording(liveInputId, 'video456')).resolves.toBe(false);
      const replay = await ctx.service.getPublic(live.id);
      expect(replay.playback).toEqual(ctx.stream.videoPlayback('video123'));
      await expect(ctx.service.listPublic('ENDED')).resolves.toEqual([replay]);
      expect(await events.forSession(live.id)).toContainEqual({
        type: 'recording.ready',
        sessionId: live.id,
      });
    });

    it('hides sessions of a suspended vendor', async () => {
      const { session } = await liveSession();
      await ctx.db.vendor.update({ where: { id: vendorId }, data: { status: 'SUSPENDED' } });
      await expect(ctx.service.listPublic()).resolves.toEqual([]);
      await expect(ctx.service.getPublic(session.id)).rejects.toMatchObject({
        code: 'live.error.not-found',
      });
    });
  });
});
