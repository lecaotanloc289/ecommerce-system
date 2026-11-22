import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseLiveInputNotification,
  parseStreamVideoWebhook,
  verifyNotificationWebhook,
  verifyStreamWebhookSignature,
} from '../src/index.js';
import { fixture, fixtureText } from './fixtures.js';

const SECRET = 'stream-webhook-secret';
const NOW = 1_700_000_000;

function sign(time: number | string, body: string | Uint8Array, secret = SECRET): string {
  return createHmac('sha256', secret)
    .update(`${time}.`)
    .update(typeof body === 'string' ? Buffer.from(body, 'utf8') : body)
    .digest('hex');
}

describe('verifyStreamWebhookSignature', () => {
  const rawBody = fixtureText('stream-video-ready');
  const header = `time=${NOW},sig1=${sign(NOW, rawBody)}`;

  it('accepts a valid signature (string and byte bodies)', () => {
    expect(
      verifyStreamWebhookSignature({
        signatureHeader: header,
        rawBody,
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toBe(true);
    expect(
      verifyStreamWebhookSignature({
        signatureHeader: header,
        rawBody: new TextEncoder().encode(rawBody),
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toBe(true);
  });

  it('accepts uppercase hex, whitespace around parts and unknown extra keys', () => {
    const sig = sign(NOW, rawBody).toUpperCase();
    expect(
      verifyStreamWebhookSignature({
        signatureHeader: ` time=${NOW} , sig1=${sig} ,sig2=whatever`,
        rawBody,
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toBe(true);
  });

  it('accepts when any of several sig1 values matches', () => {
    const bad = '0'.repeat(64);
    expect(
      verifyStreamWebhookSignature({
        signatureHeader: `time=${NOW},sig1=${bad},sig1=${sign(NOW, rawBody)}`,
        rawBody,
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toBe(true);
  });

  it('rejects the wrong secret', () => {
    expect(
      verifyStreamWebhookSignature({
        signatureHeader: header,
        rawBody,
        secret: 'other',
        nowSeconds: NOW,
      }),
    ).toBe(false);
  });

  it('rejects a tampered body (even whitespace)', () => {
    const tampered = rawBody.replace('"readyToStream": true', '"readyToStream": false');
    expect(tampered).not.toBe(rawBody);
    for (const body of [tampered, `${rawBody} `, JSON.stringify(JSON.parse(rawBody))]) {
      expect(
        verifyStreamWebhookSignature({
          signatureHeader: header,
          rawBody: body,
          secret: SECRET,
          nowSeconds: NOW,
        }),
      ).toBe(false);
    }
  });

  it('rejects a tampered timestamp', () => {
    const forged = `time=${NOW + 1},sig1=${sign(NOW, rawBody)}`;
    expect(
      verifyStreamWebhookSignature({
        signatureHeader: forged,
        rawBody,
        secret: SECRET,
        nowSeconds: NOW,
      }),
    ).toBe(false);
  });

  it('enforces the tolerance window in both directions', () => {
    const at = (offset: number, toleranceSeconds?: number) => {
      const time = NOW + offset;
      return verifyStreamWebhookSignature({
        signatureHeader: `time=${time},sig1=${sign(time, rawBody)}`,
        rawBody,
        secret: SECRET,
        nowSeconds: NOW,
        ...(toleranceSeconds === undefined ? {} : { toleranceSeconds }),
      });
    };
    expect(at(-300)).toBe(true);
    expect(at(300)).toBe(true);
    expect(at(-301)).toBe(false); // stale
    expect(at(301)).toBe(false); // from the future
    expect(at(-60, 30)).toBe(false);
    expect(at(-30, 30)).toBe(true);
  });

  it.each([
    undefined,
    null,
    '',
    'garbage',
    `sig1=${'a'.repeat(64)}`,
    `time=${NOW}`,
    `time=${NOW},sig1=`,
    `time=${NOW},sig1=zz${'a'.repeat(62)}`,
    `time=${NOW},sig1=${'a'.repeat(63)}`,
    `time=${NOW},sig1=${'a'.repeat(66)}`,
    `time=abc,sig1=${'a'.repeat(64)}`,
    `time=-5,sig1=${'a'.repeat(64)}`,
    `time=1.5,sig1=${'a'.repeat(64)}`,
    `time=${NOW},time=${NOW},sig1=${'a'.repeat(64)}`,
    `=x,time=${NOW},sig1=${'a'.repeat(64)}`,
    `time=${NOW},,sig1=${'a'.repeat(64)}`,
  ])('rejects malformed header %j without throwing', (signatureHeader) => {
    expect(
      verifyStreamWebhookSignature({ signatureHeader, rawBody, secret: SECRET, nowSeconds: NOW }),
    ).toBe(false);
  });

  it('rejects an empty secret and a non-finite clock', () => {
    expect(
      verifyStreamWebhookSignature({
        signatureHeader: header,
        rawBody,
        secret: '',
        nowSeconds: NOW,
      }),
    ).toBe(false);
    expect(
      verifyStreamWebhookSignature({
        signatureHeader: header,
        rawBody,
        secret: SECRET,
        nowSeconds: Number.NaN,
      }),
    ).toBe(false);
  });
});

describe('verifyNotificationWebhook', () => {
  const secret = 'notifications-secret';

  it('accepts the exact secret in cf-webhook-auth (any header casing)', () => {
    expect(verifyNotificationWebhook({ 'cf-webhook-auth': secret }, secret)).toBe(true);
    expect(verifyNotificationWebhook({ 'CF-Webhook-Auth': secret }, secret)).toBe(true);
    expect(verifyNotificationWebhook({ 'cf-webhook-auth': [secret] }, secret)).toBe(true);
    expect(verifyNotificationWebhook(new Headers({ 'cf-webhook-auth': secret }), secret)).toBe(
      true,
    );
  });

  it.each([
    [{}],
    [{ 'cf-webhook-auth': undefined }],
    [{ 'cf-webhook-auth': '' }],
    [{ 'cf-webhook-auth': 'wrong' }],
    [{ 'cf-webhook-auth': `${secret} ` }],
    [{ 'cf-webhook-auth': secret.slice(0, -1) }],
    [{ 'cf-webhook-auth': [secret, secret] }],
    [{ 'cf-webhook-auth': [] }],
    [{ authorization: secret }],
  ])('rejects %j', (headers) => {
    expect(verifyNotificationWebhook(headers, secret)).toBe(false);
  });

  it('rejects when no secret is configured', () => {
    expect(verifyNotificationWebhook({ 'cf-webhook-auth': '' }, '')).toBe(false);
  });
});

describe('parseLiveInputNotification', () => {
  it.each([
    ['notification-live-input-connected', 'connected', '2022-01-13T11:40:02.123Z'],
    ['notification-live-input-disconnected', 'disconnected', '2022-01-13T11:43:41.855Z'],
    ['notification-live-input-errored', 'errored', '2022-01-13T11:45:10.000Z'],
  ] as const)('parses %s', (name, event, iso) => {
    expect(parseLiveInputNotification(fixture(name))).toEqual({
      liveInputId: 'eb222fcca08eeb1ae84c981ebe8aeeb6',
      event,
      occurredAt: new Date(iso),
    });
  });

  it('falls back to ts when updated_at is missing or unparseable', () => {
    for (const updated_at of [undefined, 'not a date']) {
      const json = {
        data: {
          input_id: 'eb222fcca08eeb1ae84c981ebe8aeeb6',
          event_type: 'live_input.connected',
          updated_at,
        },
        ts: 1642074233,
      };
      expect(parseLiveInputNotification(json)?.occurredAt).toEqual(new Date(1642074233 * 1000));
    }
  });

  it.each([
    null,
    undefined,
    'string',
    42,
    [],
    {},
    { data: null },
    {
      data: {
        input_id: 'eb222fcca08eeb1ae84c981ebe8aeeb6',
        event_type: 'live_input.reconnected',
        updated_at: '2022-01-13T11:43:41Z',
      },
    },
    {
      data: {
        input_id: '',
        event_type: 'live_input.connected',
        updated_at: '2022-01-13T11:43:41Z',
      },
    },
    {
      data: {
        input_id: '../x',
        event_type: 'live_input.connected',
        updated_at: '2022-01-13T11:43:41Z',
      },
    },
    { data: { input_id: 'eb222fcca08eeb1ae84c981ebe8aeeb6', event_type: 'live_input.connected' } },
    {
      data: {
        input_id: 'eb222fcca08eeb1ae84c981ebe8aeeb6',
        event_type: 'live_input.connected',
        updated_at: 'nope',
      },
    },
    {
      data: {
        input_id: 'eb222fcca08eeb1ae84c981ebe8aeeb6',
        event_type: 'live_input.connected',
        updated_at: 'nope',
      },
      ts: -1,
    },
  ])('returns null for junk %#', (json) => {
    expect(parseLiveInputNotification(json)).toBeNull();
  });

  it('keeps an event whose fallback ts is malformed when updated_at is valid', () => {
    const parsed = parseLiveInputNotification({
      data: {
        input_id: 'eb222fcca08eeb1ae84c981ebe8aeeb6',
        event_type: 'live_input.disconnected',
        updated_at: '2022-01-13T11:43:41.855717910Z',
      },
      ts: 1642074233.5,
    });
    expect(parsed?.event).toBe('disconnected');
    expect(parsed?.occurredAt.toISOString()).toBe('2022-01-13T11:43:41.855Z');
  });
});

describe('parseStreamVideoWebhook', () => {
  it('parses the documented upload payload (no liveInput)', () => {
    expect(parseStreamVideoWebhook(fixture('stream-video-ready'))).toEqual({
      videoId: '6b9e68b07dfee8cc2d116e4c51d6a957',
      liveInputId: null,
      readyToStream: true,
    });
  });

  it('parses a live recording payload with liveInput', () => {
    expect(parseStreamVideoWebhook(fixture('stream-video-live-recording'))).toEqual({
      videoId: 'a2c3b8b8f1d14c3fa9e0c4f7f3b9d001',
      liveInputId: 'eb222fcca08eeb1ae84c981ebe8aeeb6',
      readyToStream: true,
    });
  });

  it('treats a missing/null readyToStream as false and empty liveInput as null', () => {
    expect(
      parseStreamVideoWebhook({
        uid: 'abc',
        readyToStream: null,
        liveInput: '',
        status: { state: 'error' },
      }),
    ).toEqual({ videoId: 'abc', liveInputId: null, readyToStream: false });
    expect(parseStreamVideoWebhook({ uid: 'abc' })).toEqual({
      videoId: 'abc',
      liveInputId: null,
      readyToStream: false,
    });
  });

  it.each([
    null,
    undefined,
    'x',
    [],
    {},
    { uid: '' },
    { uid: 123 },
    { uid: 'a/b', readyToStream: true },
    { uid: 'abc', readyToStream: 'yes' },
    { uid: 'abc', liveInput: 42 },
  ])('returns null for junk %#', (json) => {
    expect(parseStreamVideoWebhook(json)).toBeNull();
  });
});
