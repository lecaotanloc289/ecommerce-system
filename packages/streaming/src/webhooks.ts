import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { StreamResourceIdSchema } from './provider.js';

// All functions here are total: malformed input returns false / null, never throws.

/** Fastify/Node style (`req.headers`) or a WHATWG `Headers` instance. */
export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;

export const NOTIFICATION_AUTH_HEADER = 'cf-webhook-auth';
export const STREAM_SIGNATURE_HEADER = 'webhook-signature';

function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    if (typeof value === 'string') return value;
    // A repeated auth header is ambiguous — treat it as absent.
    return Array.isArray(value) && value.length === 1 ? value[0] : undefined;
  }
  return undefined;
}

/**
 * Cloudflare Notifications (generic webhook destination) send the configured secret verbatim in
 * `cf-webhook-auth`. Compared in constant time: both sides are SHA-256'd first so the comparison
 * length never depends on the secret.
 */
export function verifyNotificationWebhook(headers: WebhookHeaders, secret: string): boolean {
  try {
    if (secret.length === 0) return false;
    const received = readHeader(headers, NOTIFICATION_AUTH_HEADER);
    if (received === undefined || received.length === 0) return false;
    const a = createHash('sha256').update(received, 'utf8').digest();
    const b = createHash('sha256').update(secret, 'utf8').digest();
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const HEX_SHA256 = /^[0-9a-f]{64}$/i;
const UNIX_SECONDS = /^\d{1,12}$/;

export interface VerifyStreamWebhookSignatureInput {
  /** Raw `Webhook-Signature` header: `time=<unix seconds>,sig1=<hex hmac-sha256>`. */
  signatureHeader: string | null | undefined;
  /** The request body exactly as received — re-serialised JSON will not verify. */
  rawBody: string | Uint8Array;
  /** Secret returned by `PUT /accounts/{id}/stream/webhook`. */
  secret: string;
  /** Current time in Unix seconds (injected so callers and tests control the clock). */
  nowSeconds: number;
  /** Max allowed |now − time| in seconds. Default 300. */
  toleranceSeconds?: number;
}

/**
 * Stream (video) webhook signature: HMAC-SHA256(secret, `${time}.${rawBody}`), hex, in
 * `Webhook-Signature: time=…,sig1=…`. Rejects timestamps more than `toleranceSeconds` away from
 * `nowSeconds` in either direction (replay window); any `sig1` entry may match.
 */
export function verifyStreamWebhookSignature({
  signatureHeader,
  rawBody,
  secret,
  nowSeconds,
  toleranceSeconds = 300,
}: VerifyStreamWebhookSignatureInput): boolean {
  try {
    if (secret.length === 0 || typeof signatureHeader !== 'string') return false;
    if (!Number.isFinite(nowSeconds) || !(toleranceSeconds >= 0)) return false;

    let time: string | undefined;
    const signatures: Buffer[] = [];
    for (const part of signatureHeader.split(',')) {
      const eq = part.indexOf('=');
      if (eq <= 0) return false;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === 'time') {
        if (time !== undefined || !UNIX_SECONDS.test(value)) return false;
        time = value;
      } else if (key === 'sig1') {
        if (!HEX_SHA256.test(value)) return false;
        signatures.push(Buffer.from(value, 'hex'));
      }
      // Unknown keys (a future sig2, …) are ignored.
    }
    if (time === undefined || signatures.length === 0) return false;
    if (Math.abs(nowSeconds - Number(time)) > toleranceSeconds) return false;

    const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody);
    const expected = createHmac('sha256', secret)
      .update(Buffer.from(`${time}.`, 'utf8'))
      .update(body)
      .digest();

    // Check every candidate so timing does not reveal which one matched.
    let isValid = false;
    for (const signature of signatures) {
      if (timingSafeEqual(signature, expected)) isValid = true;
    }
    return isValid;
  } catch {
    return false;
  }
}

export type LiveInputEvent = 'connected' | 'disconnected' | 'errored';

export interface LiveInputNotification {
  liveInputId: string;
  event: LiveInputEvent;
  occurredAt: Date;
}

const LIVE_INPUT_EVENTS = {
  'live_input.connected': 'connected',
  'live_input.disconnected': 'disconnected',
  'live_input.errored': 'errored',
} as const satisfies Record<string, LiveInputEvent>;

const LiveInputNotificationSchema = z.object({
  data: z.object({
    input_id: StreamResourceIdSchema,
    event_type: z.enum(['live_input.connected', 'live_input.disconnected', 'live_input.errored']),
    updated_at: z.string().optional(),
  }),
  // Fallback only — a malformed `ts` must not drop an event whose `updated_at` is fine.
  ts: z.number().positive().optional().catch(undefined),
});

/**
 * Notifications "Stream Live Input" payload →
 * `{ liveInputId, event, occurredAt }`. `occurredAt` = `data.updated_at` (RFC 3339, ns precision
 * truncated to ms), falling back to top-level `ts` (Unix seconds). Unknown event / junk → null.
 */
export function parseLiveInputNotification(json: unknown): LiveInputNotification | null {
  const parsed = LiveInputNotificationSchema.safeParse(json);
  if (!parsed.success) return null;
  const { data, ts } = parsed.data;

  let occurredAt: Date | null = null;
  if (data.updated_at !== undefined) {
    const ms = Date.parse(data.updated_at);
    if (!Number.isNaN(ms)) occurredAt = new Date(ms);
  }
  if (occurredAt === null && ts !== undefined) occurredAt = new Date(ts * 1000);
  if (occurredAt === null || Number.isNaN(occurredAt.getTime())) return null;

  return {
    liveInputId: data.input_id,
    event: LIVE_INPUT_EVENTS[data.event_type],
    occurredAt,
  };
}

export interface StreamVideoWebhook {
  videoId: string;
  liveInputId: string | null;
  readyToStream: boolean;
}

const StreamVideoWebhookSchema = z.object({
  uid: StreamResourceIdSchema,
  readyToStream: z.boolean().nullish(),
  liveInput: z.string().nullish(),
});

/**
 * Stream video webhook payload (the Video object) → `{ videoId, liveInputId, readyToStream }`.
 * `liveInput` is null/absent for plain uploads (and possibly for live recordings — see CLAUDE.md);
 * an empty or non-id `liveInput` maps to null. Missing `readyToStream` = false. Junk → null.
 */
export function parseStreamVideoWebhook(json: unknown): StreamVideoWebhook | null {
  const parsed = StreamVideoWebhookSchema.safeParse(json);
  if (!parsed.success) return null;
  const { uid, readyToStream, liveInput } = parsed.data;
  const liveInputId =
    liveInput != null && StreamResourceIdSchema.safeParse(liveInput).success ? liveInput : null;
  return { videoId: uid, liveInputId, readyToStream: readyToStream === true };
}
