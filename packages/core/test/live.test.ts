import { describe, expect, it } from 'vitest';
import {
  CreateLiveSessionSchema,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  LIVE_OUTBOX_EVENT_TYPES,
  ListLiveSessionsQuerySchema,
  LiveChatMessageIdSchema,
  LiveChatMessageSchema,
  LiveEndReasonSchema,
  LiveEventSchema,
  LiveIngestCredentialsSchema,
  LiveOutboxEventSchema,
  LivePlaybackSchema,
  LiveSessionIdSchema,
  LiveSessionSchema,
  LiveSessionStatusSchema,
  LiveSessionTitleSchema,
  MuteLiveUserSchema,
  ReactionKindSchema,
  ReplaceLiveSessionProductsSchema,
  SendLiveChatMessageSchema,
  SendLiveReactionSchema,
  SimulateEncoderSchema,
  TerminateLiveSessionSchema,
  VendorLiveSessionSchema,
} from '../src';
import { ulid } from './fixtures';

const NOW = '2026-11-23T10:00:00.000Z';
const sid = ulid(1);
const vid = ulid(2);
const uid = ulid(3);
const pid = (n: number): string => ulid(100 + n);
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => pid(i));

const product = { productId: pid(1), position: 0, pinnedAt: null };
const session = {
  id: sid,
  vendorId: vid,
  title: 'Flash sale',
  status: 'LIVE',
  scheduledAt: null,
  startedAt: NOW,
  endedAt: null,
  endReason: null,
  peakViewers: 0,
  playback: { hlsUrl: 'https://x.test/a.m3u8', iframeUrl: 'https://x.test/iframe' },
  products: [product],
};
const message = {
  id: '1700000000000-0',
  sessionId: sid,
  userId: uid,
  displayName: 'An',
  text: 'hi',
  sentAt: NOW,
};

describe('live enums, ids, errors', () => {
  it('validates enums', () => {
    expect(LiveSessionStatusSchema.options).toEqual(['SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED']);
    expect(LiveEndReasonSchema.safeParse('VENDOR').success).toBe(true);
    expect(LiveEndReasonSchema.safeParse('nope').success).toBe(false);
    expect(ReactionKindSchema.safeParse('HEART').success).toBe(true);
    expect(ReactionKindSchema.safeParse('ANGRY').success).toBe(false);
  });

  it('validates ids', () => {
    expect(LiveSessionIdSchema.safeParse(sid).success).toBe(true);
    expect(LiveSessionIdSchema.safeParse('abc').success).toBe(false);
    expect(LiveChatMessageIdSchema.safeParse('1700000000000-12').success).toBe(true);
    expect(LiveChatMessageIdSchema.safeParse('1700000000000').success).toBe(false);
  });

  it('has the 13 live error codes with statuses', () => {
    const live = ERROR_CODES.filter((c) => c.startsWith('live.error.'));
    expect(live).toHaveLength(13);
    expect(ERROR_HTTP_STATUS['live.error.not-found']).toBe(404);
    expect(ERROR_HTTP_STATUS['live.error.chat-rate-limited']).toBe(429);
    expect(ERROR_HTTP_STATUS['live.error.chat-muted']).toBe(403);
    expect(ERROR_HTTP_STATUS['live.error.webhook-signature-invalid']).toBe(401);
    expect(ERROR_HTTP_STATUS['live.error.stream-provider-unavailable']).toBe(503);
    expect(ERROR_HTTP_STATUS['live.error.product-inactive']).toBe(422);
  });
});

describe('live request schemas', () => {
  it('title trims and bounds length', () => {
    expect(LiveSessionTitleSchema.parse('  abc  ')).toBe('abc');
    expect(LiveSessionTitleSchema.safeParse('  ab  ').success).toBe(false);
    expect(LiveSessionTitleSchema.safeParse('a'.repeat(120)).success).toBe(true);
    expect(LiveSessionTitleSchema.safeParse('a'.repeat(121)).success).toBe(false);
  });

  it('CreateLiveSession defaults scheduledAt and rejects bad products', () => {
    const ok = CreateLiveSessionSchema.parse({ title: 'Flash sale', productIds: ids(2) });
    expect(ok.scheduledAt).toBeNull();
    expect(
      CreateLiveSessionSchema.safeParse({ title: 'Flash sale', scheduledAt: NOW, productIds: [] })
        .success,
    ).toBe(true);
    expect(
      CreateLiveSessionSchema.safeParse({
        title: 'Flash sale',
        scheduledAt: '2026-12-01T10:00:00+07:00',
        productIds: [],
      }).success,
    ).toBe(true);
    expect(
      CreateLiveSessionSchema.safeParse({
        title: 'Flash sale',
        scheduledAt: 'tomorrow',
        productIds: [],
      }).success,
    ).toBe(false);
    expect(
      CreateLiveSessionSchema.safeParse({ title: 'Flash sale', productIds: [pid(1), pid(1)] })
        .success,
    ).toBe(false);
    expect(
      CreateLiveSessionSchema.safeParse({ title: 'Flash sale', productIds: ids(50) }).success,
    ).toBe(true);
    expect(
      CreateLiveSessionSchema.safeParse({ title: 'Flash sale', productIds: ids(51) }).success,
    ).toBe(false);
  });

  it('does not accept vendorId in create (stripped)', () => {
    const parsed = CreateLiveSessionSchema.parse({
      title: 'Flash sale',
      productIds: [],
      vendorId: vid,
    });
    expect('vendorId' in parsed).toBe(false);
  });

  it('ReplaceLiveSessionProducts', () => {
    expect(ReplaceLiveSessionProductsSchema.safeParse({ productIds: ids(3) }).success).toBe(true);
    expect(
      ReplaceLiveSessionProductsSchema.safeParse({ productIds: [pid(1), pid(1)] }).success,
    ).toBe(false);
    expect(ReplaceLiveSessionProductsSchema.safeParse({ productIds: ids(51) }).success).toBe(false);
    expect(ReplaceLiveSessionProductsSchema.safeParse({ productIds: ['x'] }).success).toBe(false);
  });

  it('TerminateLiveSession', () => {
    expect(TerminateLiveSessionSchema.parse({ reason: '  policy  ' }).reason).toBe('policy');
    expect(TerminateLiveSessionSchema.safeParse({ reason: 'ab' }).success).toBe(false);
    expect(TerminateLiveSessionSchema.safeParse({ reason: 'a'.repeat(501) }).success).toBe(false);
  });

  it('SendLiveChatMessage', () => {
    const base = { clientMessageId: ulid(9) };
    expect(SendLiveChatMessageSchema.safeParse({ ...base, text: 'hello' }).success).toBe(true);
    expect(SendLiveChatMessageSchema.safeParse({ ...base, text: 'a'.repeat(200) }).success).toBe(
      true,
    );
    expect(SendLiveChatMessageSchema.safeParse({ ...base, text: '' }).success).toBe(false);
    expect(SendLiveChatMessageSchema.safeParse({ ...base, text: '   ' }).success).toBe(false);
    expect(SendLiveChatMessageSchema.safeParse({ ...base, text: 'a'.repeat(201) }).success).toBe(
      false,
    );
    expect(SendLiveChatMessageSchema.safeParse({ clientMessageId: 'x', text: 'hi' }).success).toBe(
      false,
    );
  });

  it('SendLiveReaction, MuteLiveUser, ListQuery, SimulateEncoder', () => {
    expect(SendLiveReactionSchema.safeParse({ kind: 'WOW' }).success).toBe(true);
    expect(SendLiveReactionSchema.safeParse({ kind: 'wow' }).success).toBe(false);
    expect(MuteLiveUserSchema.safeParse({ userId: uid }).success).toBe(true);
    expect(MuteLiveUserSchema.safeParse({ userId: 'x' }).success).toBe(false);
    expect(ListLiveSessionsQuerySchema.safeParse({}).success).toBe(true);
    expect(ListLiveSessionsQuerySchema.safeParse({ status: 'LIVE' }).success).toBe(true);
    expect(ListLiveSessionsQuerySchema.safeParse({ status: 'PAUSED' }).success).toBe(false);
    expect(SimulateEncoderSchema.safeParse({ connected: true }).success).toBe(true);
    expect(SimulateEncoderSchema.safeParse({ connected: 'yes' }).success).toBe(false);
  });
});

describe('live read schemas', () => {
  it('LivePlayback', () => {
    expect(LivePlaybackSchema.safeParse(session.playback).success).toBe(true);
    expect(
      LivePlaybackSchema.safeParse({ hlsUrl: 'nope', iframeUrl: 'https://x.test' }).success,
    ).toBe(false);
  });

  it('LiveSession and VendorLiveSession', () => {
    expect(LiveSessionSchema.safeParse(session).success).toBe(true);
    expect(
      LiveSessionSchema.safeParse({ ...session, playback: null, endReason: 'VENDOR' }).success,
    ).toBe(true);
    expect(LiveSessionSchema.safeParse({ ...session, peakViewers: -1 }).success).toBe(false);
    expect(LiveSessionSchema.safeParse({ ...session, status: 'PAUSED' }).success).toBe(false);
    const vendor = {
      ...session,
      isProvisioned: true,
      isEncoderConnected: false,
      endNote: null,
      createdAt: NOW,
    };
    expect(VendorLiveSessionSchema.safeParse(vendor).success).toBe(true);
    expect(VendorLiveSessionSchema.safeParse(session).success).toBe(false);
  });

  it('LiveIngestCredentials', () => {
    expect(
      LiveIngestCredentialsSchema.safeParse({
        rtmpsUrl: 'rtmps://live.test:443/live/',
        streamKey: 'k',
      }).success,
    ).toBe(true);
    expect(
      LiveIngestCredentialsSchema.safeParse({ rtmpsUrl: 'rtmp://x', streamKey: 'k' }).success,
    ).toBe(false);
    expect(
      LiveIngestCredentialsSchema.safeParse({ rtmpsUrl: 'rtmps://x', streamKey: '' }).success,
    ).toBe(false);
  });

  it('LiveChatMessage', () => {
    expect(LiveChatMessageSchema.safeParse(message).success).toBe(true);
    expect(LiveChatMessageSchema.safeParse({ ...message, id: 'abc' }).success).toBe(false);
  });
});

describe('LiveEventSchema', () => {
  const valid = [
    { type: 'session.provisioned', sessionId: sid },
    { type: 'session.live', sessionId: sid, startedAt: NOW },
    { type: 'session.ended', sessionId: sid, endedAt: NOW, endReason: 'VENDOR' },
    { type: 'session.cancelled', sessionId: sid },
    { type: 'encoder.status', sessionId: sid, isConnected: true },
    { type: 'products.updated', sessionId: sid, products: [product] },
    { type: 'product.pinned', sessionId: sid, productId: pid(1), pinnedAt: NOW },
    { type: 'product.unpinned', sessionId: sid, productId: pid(1) },
    { type: 'chat.message', message },
    { type: 'chat.deleted', sessionId: sid, messageId: '1700000000000-0' },
    { type: 'reaction.burst', sessionId: sid, counts: { HEART: 3, CLAP: 1 } },
    { type: 'viewers.updated', sessionId: sid, count: 42 },
    { type: 'recording.ready', sessionId: sid },
  ];

  it.each(valid.map((e) => [e.type, e] as const))('parses %s', (_type, event) => {
    expect(LiveEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejects unknown type and bad variants', () => {
    expect(LiveEventSchema.safeParse({ type: 'session.exploded', sessionId: sid }).success).toBe(
      false,
    );
    expect(LiveEventSchema.safeParse({ type: 'session.live', sessionId: sid }).success).toBe(false);
    expect(
      LiveEventSchema.safeParse({ type: 'reaction.burst', sessionId: sid, counts: { HEART: 0 } })
        .success,
    ).toBe(false);
    expect(
      LiveEventSchema.safeParse({ type: 'reaction.burst', sessionId: sid, counts: { ANGRY: 1 } })
        .success,
    ).toBe(false);
    expect(
      LiveEventSchema.safeParse({ type: 'viewers.updated', sessionId: sid, count: -1 }).success,
    ).toBe(false);
  });
});

describe('LiveOutboxEventSchema', () => {
  const valid = [
    { eventType: 'live_session.provision_requested', payload: { liveSessionId: sid } },
    {
      eventType: 'live_session.started',
      payload: { liveSessionId: sid, vendorId: vid, startedAt: NOW },
    },
    {
      eventType: 'live_session.encoder_disconnected',
      payload: { liveSessionId: sid, disconnectedAt: NOW },
    },
    {
      eventType: 'live_session.ended',
      payload: { liveSessionId: sid, vendorId: vid, liveInputId: null, endReason: 'TERMINATED' },
    },
    { eventType: 'live_session.cancelled', payload: { liveSessionId: sid, liveInputId: 'abc' } },
  ];

  it('covers every exported event type', () => {
    expect(valid.map((e) => e.eventType)).toEqual([...LIVE_OUTBOX_EVENT_TYPES]);
  });

  it.each(valid.map((e) => [e.eventType, e] as const))('parses %s', (_type, event) => {
    expect(LiveOutboxEventSchema.safeParse(event).success).toBe(true);
  });

  it('rejects payload/eventType mismatch and unknown types', () => {
    expect(
      LiveOutboxEventSchema.safeParse({
        eventType: 'live_session.started',
        payload: { liveSessionId: sid },
      }).success,
    ).toBe(false);
    expect(
      LiveOutboxEventSchema.safeParse({
        eventType: 'live_session.cancelled',
        payload: { liveSessionId: sid, vendorId: vid, startedAt: NOW },
      }).success,
    ).toBe(false);
    expect(
      LiveOutboxEventSchema.safeParse({ eventType: 'live_session.nope', payload: {} }).success,
    ).toBe(false);
  });
});
