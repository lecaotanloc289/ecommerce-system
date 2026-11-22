import { z } from 'zod';

/** Public playback URLs for a live input or a recorded video. Safe to send to browsers. */
export interface StreamPlayback {
  hlsUrl: string;
  iframeUrl: string;
}

/** RTMPS ingest credentials. The stream key is a secret: only the owning vendor may see it. */
export interface StreamIngestCredentials {
  rtmpsUrl: string;
  streamKey: string;
}

/**
 * Live video provider (plan §1.6). One live input per live session. Network methods throw
 * `StreamProviderError`; playback methods are pure (no network).
 */
export interface StreamProvider {
  createLiveInput(input: { liveSessionId: string }): Promise<{ liveInputId: string }>;
  getIngestCredentials(liveInputId: string): Promise<StreamIngestCredentials>;
  /** Stop accepting broadcasts on this input; recordings must survive. Idempotent (404 = done). */
  retireLiveInput(liveInputId: string): Promise<void>;
  /** Pure — no network. */
  livePlayback(liveInputId: string): StreamPlayback;
  /** Pure — no network. */
  videoPlayback(videoId: string): StreamPlayback;
}

/**
 * Every provider failure. `retryable` tells the outbox worker whether to retry (network error,
 * timeout, 5xx, 408, 429) or give up (other 4xx, malformed response, invalid argument).
 * Messages never contain the API token or the stream key.
 */
export class StreamProviderError extends Error {
  override readonly name = 'StreamProviderError';
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable: boolean; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    if (options.status !== undefined) this.status = options.status;
    this.retryable = options.retryable;
  }
}

export function isStreamProviderError(value: unknown): value is StreamProviderError {
  return value instanceof StreamProviderError;
}

/**
 * Cloudflare ids (account, live input, video) are documented as `maxLength: 32`; in practice they
 * are 32 lowercase hex chars. Validated before they are put into a URL path.
 */
export const StreamResourceIdSchema = z.string().regex(/^[A-Za-z0-9]{1,32}$/);

/** `customer-<code>.cloudflarestream.com` — the code is a DNS label. */
export const CustomerCodeSchema = z.string().regex(/^[a-z0-9]{1,63}$/);

export function assertResourceId(kind: string, value: string): void {
  if (!StreamResourceIdSchema.safeParse(value).success) {
    throw new StreamProviderError(`Invalid ${kind} id`, { retryable: false });
  }
}

export function playbackUrls(customerCode: string, id: string): StreamPlayback {
  const base = `https://customer-${customerCode}.cloudflarestream.com/${id}`;
  return { hlsUrl: `${base}/manifest/video.m3u8`, iframeUrl: `${base}/iframe` };
}
