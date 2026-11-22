import { createHash, createHmac } from 'node:crypto';
import { ulid } from 'ulid';
import { createProduct, createVendor, resetDatabase, resetRedis } from '../integration/pg';
import {
  captureLiveEvents,
  createLiveTestApp,
  type LiveTestApp,
  NOTIFICATIONS_SECRET,
  outboxEventTypes,
  provision,
  STREAM_SECRET,
  vendorUser,
} from './live-test-app';

/** Cloudflare webhooks over HTTP: auth, raw-body signature, replay guard, encoder ordering. */
describe('Live webhooks HTTP', () => {
  let ctx: LiveTestApp;
  let events: Awaited<ReturnType<typeof captureLiveEvents>>;
  let sessionId: string;
  let liveInputId: string;
  let ownerId: string;
  let vendorId: string;

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
    ({ vendorId, ownerId } = await createVendor(ctx.db));
    const productId = await createProduct(ctx.db, vendorId);
    const { session } = await ctx.service.create(vendorUser(ownerId, vendorId), ulid(), {
      title: 'Webhook show',
      scheduledAt: null,
      productIds: [productId],
    });
    sessionId = session.id;
    liveInputId = await provision(ctx, sessionId);
  });

  /** Doc-shaped "Stream Live Input" notification. */
  function notification(
    event: 'connected' | 'disconnected' | 'errored',
    at: Date,
    inputId = liveInputId,
  ) {
    return JSON.stringify({
      name: 'Live input webhook',
      text: `Live input ${event}`,
      ts: Math.floor(at.getTime() / 1000),
      data: {
        notification_name: 'Stream Live Input',
        input_id: inputId,
        event_type: `live_input.${event}`,
        updated_at: at.toISOString(),
      },
    });
  }

  function postLiveInput(body: string, secret: string | null = NOTIFICATIONS_SECRET) {
    return ctx.app.inject({
      method: 'POST',
      url: '/v1/webhooks/cloudflare/live-input',
      headers: {
        'content-type': 'application/json',
        ...(secret !== null && { 'cf-webhook-auth': secret }),
      },
      payload: body,
    });
  }

  async function encoderRow() {
    return ctx.db.liveSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: {
        status: true,
        encoderConnectedAt: true,
        encoderDisconnectedAt: true,
        encoderStatusAt: true,
      },
    });
  }

  describe('POST /webhooks/cloudflare/live-input', () => {
    it('rejects a missing or wrong cf-webhook-auth with 401 and changes nothing', async () => {
      const body = notification('connected', new Date());
      for (const secret of [null, 'wrong-secret']) {
        const res = await postLiveInput(body, secret);
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({
          errorCode: 'live.error.webhook-signature-invalid',
          params: {},
        });
      }
      expect((await encoderRow()).encoderConnectedAt).toBeNull();
      // Unauthenticated requests never claim a dedupe slot.
      await expect(ctx.redis.keys('live:webhook-dedupe:*')).resolves.toEqual([]);
    });

    it('applies a connect (204) and publishes encoder.status', async () => {
      const at = new Date('2026-01-15T09:00:00.000Z');
      const res = await postLiveInput(notification('connected', at));
      expect(res.statusCode).toBe(204);
      expect(await encoderRow()).toMatchObject({ encoderConnectedAt: at, encoderStatusAt: at });
      expect(await events.forSession(sessionId)).toContainEqual({
        type: 'encoder.status',
        sessionId,
        isConnected: true,
      });
    });

    it('processes a duplicate delivery once (sha256 of the raw body, 24 h)', async () => {
      // Go live so a disconnect writes an outbox row we can count.
      await postLiveInput(notification('connected', new Date(Date.now() - 10_000)));
      await ctx.service.goLive(vendorUser(ownerId, vendorId), sessionId);

      const body = notification('disconnected', new Date());
      expect((await postLiveInput(body)).statusCode).toBe(204);
      expect((await postLiveInput(body)).statusCode).toBe(204);

      const disconnects = (await outboxEventTypes(ctx, sessionId)).filter(
        (type) => type === 'live_session.encoder_disconnected',
      );
      expect(disconnects).toHaveLength(1);
      const key = `live:webhook-dedupe:${createHash('sha256').update(body).digest('hex')}`;
      await expect(ctx.redis.ttl(key)).resolves.toBeGreaterThan(86_000);
    });

    it('claims a delivery briefly (60 s) while applying; a failed apply releases the claim', async () => {
      const body = notification('connected', new Date());
      const key = `live:webhook-dedupe:${createHash('sha256').update(body).digest('hex')}`;
      let ttlDuringApply = -2;
      const apply = jest
        .spyOn(ctx.service, 'applyEncoderEvent')
        .mockImplementationOnce(async () => {
          ttlDuringApply = await ctx.redis.ttl(key);
          throw new Error('db down');
        });

      expect((await postLiveInput(body)).statusCode).toBe(500);
      expect(ttlDuringApply).toBeGreaterThan(0);
      expect(ttlDuringApply).toBeLessThanOrEqual(60);
      await expect(ctx.redis.exists(key)).resolves.toBe(0);

      // The provider's retry is processed, then the claim is kept for 24 h.
      apply.mockRestore();
      expect((await postLiveInput(body)).statusCode).toBe(204);
      expect((await encoderRow()).encoderConnectedAt).not.toBeNull();
      await expect(ctx.redis.ttl(key)).resolves.toBeGreaterThan(86_000);
    });

    it('a replayed older disconnect after a newer connect is ignored (exact replay and re-sent)', async () => {
      const t1 = new Date('2026-01-15T09:00:00.000Z');
      const t2 = new Date('2026-01-15T09:00:30.000Z');
      const oldDisconnect = notification('disconnected', t1);

      expect((await postLiveInput(oldDisconnect)).statusCode).toBe(204);
      expect((await postLiveInput(notification('connected', t2))).statusCode).toBe(204);

      // Byte-identical replay → dedupe; same event re-sent with a different body → ordering guard.
      expect((await postLiveInput(oldDisconnect)).statusCode).toBe(204);
      const resent = JSON.stringify({ ...JSON.parse(oldDisconnect), text: 'retry' });
      expect((await postLiveInput(resent)).statusCode).toBe(204);

      expect(await encoderRow()).toMatchObject({
        encoderConnectedAt: t2,
        encoderDisconnectedAt: null,
        encoderStatusAt: t2,
      });
    });

    it('acknowledges unknown inputs and junk payloads with 204', async () => {
      const unknown = await postLiveInput(
        notification('connected', new Date(), 'abcdef0123456789'),
      );
      expect(unknown.statusCode).toBe(204);
      const junk = await postLiveInput(JSON.stringify({ hello: 'world' }));
      expect(junk.statusCode).toBe(204);
      expect((await encoderRow()).encoderStatusAt).toBeNull();
    });
  });

  describe('POST /webhooks/cloudflare/stream', () => {
    function sign(rawBody: string, secret = STREAM_SECRET, time = Math.floor(Date.now() / 1000)) {
      const sig = createHmac('sha256', secret).update(`${time}.${rawBody}`).digest('hex');
      return `time=${time},sig1=${sig}`;
    }

    function postStream(rawBody: string, signature: string | null) {
      return ctx.app.inject({
        method: 'POST',
        url: '/v1/webhooks/cloudflare/stream',
        headers: {
          'content-type': 'application/json',
          ...(signature !== null && { 'webhook-signature': signature }),
        },
        payload: rawBody,
      });
    }

    async function endSession() {
      await ctx.service.applyEncoderEvent({
        liveInputId,
        isConnected: true,
        occurredAt: new Date(),
      });
      await ctx.service.goLive(vendorUser(ownerId, vendorId), sessionId);
      await ctx.service.end(vendorUser(ownerId, vendorId), sessionId);
    }

    // Deliberately not `JSON.stringify` output (spacing, key order): the signature must be
    // checked over the bytes as received, not a re-serialisation.
    const readyBody = (videoId: string, inputId: string) =>
      `{ "uid": "${videoId}",\n  "readyToStream": true, "status": { "state": "ready" },\n  "liveInput": "${inputId}" }`;

    it('a valid signature over the raw body attaches the recording and publishes recording.ready', async () => {
      await endSession();
      const body = readyBody('video0001', liveInputId);
      const res = await postStream(body, sign(body));
      expect(res.statusCode).toBe(204);

      const row = await ctx.db.liveSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(row.recordingVideoId).toBe('video0001');
      expect(await events.forSession(sessionId)).toContainEqual({
        type: 'recording.ready',
        sessionId,
      });

      const detail = await ctx.app.inject({ method: 'GET', url: `/v1/live-sessions/${sessionId}` });
      expect(detail.json()).toMatchObject({
        status: 'ENDED',
        playback: ctx.stream.videoPlayback('video0001'),
      });
    });

    it('rejects a bad, stale or missing signature with 401', async () => {
      const body = readyBody('video0001', liveInputId);
      const stale = Math.floor(Date.now() / 1000) - 3_600;
      for (const signature of [
        sign(body, 'wrong-secret'),
        sign(body, STREAM_SECRET, stale),
        null,
      ]) {
        const res = await postStream(body, signature);
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({
          errorCode: 'live.error.webhook-signature-invalid',
          params: {},
        });
      }
      // Tampered body under a signature made for the original.
      const tampered = await postStream(readyBody('video9999', liveInputId), sign(body));
      expect(tampered.statusCode).toBe(401);
      const row = await ctx.db.liveSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(row.recordingVideoId).toBeNull();
    });

    it('ignores deliveries without a live input or not ready (204)', async () => {
      const upload = '{"uid":"video0002","readyToStream":true}';
      expect((await postStream(upload, sign(upload))).statusCode).toBe(204);
      const notReady = `{"uid":"video0003","readyToStream":false,"liveInput":"${liveInputId}"}`;
      expect((await postStream(notReady, sign(notReady))).statusCode).toBe(204);
      const row = await ctx.db.liveSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(row.recordingVideoId).toBeNull();
    });
  });

  it('malformed JSON on a raw-body route is still rejected by the JSON parser (400)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/v1/webhooks/cloudflare/live-input',
      headers: { 'content-type': 'application/json', 'cf-webhook-auth': NOTIFICATIONS_SECRET },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
  });
});
