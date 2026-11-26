import { z } from 'zod';
import {
  assertResourceId,
  CustomerCodeSchema,
  playbackUrls,
  StreamProviderError,
  StreamResourceIdSchema,
  type StreamIngestCredentials,
  type StreamPlayback,
  type StreamProvider,
} from './provider.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const DEFAULT_TIMEOUT_MS = 10_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface CloudflareStreamProviderOptions {
  accountId: string;
  /** Account API token with "Stream: Edit". Never logged, never put in an error message. */
  apiToken: string;
  /** Playback subdomain code: `customer-<code>.cloudflarestream.com`. */
  customerCode: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Per-request timeout (default 10 s). A timeout is a retryable error. */
  timeoutMs?: number;
}

// Cloudflare v4 envelope: { success, errors: [{ code, message }], messages, result }.
const ApiMessageSchema = z.object({ code: z.number(), message: z.string() });
const ApiErrorEnvelopeSchema = z.object({ errors: z.array(ApiMessageSchema) });

function envelope<T extends z.ZodType>(result: T) {
  return z.object({ success: z.literal(true), result });
}

const CreatedLiveInputSchema = envelope(z.object({ uid: StreamResourceIdSchema }));

const LiveInputCredentialsSchema = envelope(
  z.object({
    uid: StreamResourceIdSchema,
    rtmps: z.object({
      url: z.string().startsWith('rtmps://'),
      streamKey: z.string().min(1),
    }),
  }),
);

/** Same length bound Cloudflare documents for the `Idempotency-Key` header. */
const LiveSessionIdSchema = z.string().min(1).max(255);

/**
 * Cloudflare Stream adapter (Stream Live inputs). See CLAUDE.md in this package for the docs
 * each request is based on.
 */
export class CloudflareStreamProvider implements StreamProvider {
  private readonly accountId: string;
  private readonly apiToken: string;
  private readonly customerCode: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: CloudflareStreamProviderOptions) {
    assertResourceId('account', options.accountId);
    if (options.apiToken.length === 0) {
      throw new StreamProviderError('Cloudflare API token is empty', { retryable: false });
    }
    if (!CustomerCodeSchema.safeParse(options.customerCode).success) {
      throw new StreamProviderError('Invalid Cloudflare Stream customer code', {
        retryable: false,
      });
    }
    this.accountId = options.accountId;
    this.apiToken = options.apiToken;
    this.customerCode = options.customerCode;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async createLiveInput(input: { liveSessionId: string }): Promise<{ liveInputId: string }> {
    if (!LiveSessionIdSchema.safeParse(input.liveSessionId).success) {
      throw new StreamProviderError('Invalid live session id', { retryable: false });
    }
    const response = await this.request('createLiveInput', 'POST', '/stream/live_inputs', {
      body: { meta: { name: input.liveSessionId }, recording: { mode: 'automatic' } },
      // Documented header on this endpoint (semantics undocumented): lets Cloudflare dedupe a
      // retried create for the same session instead of leaking a second input.
      idempotencyKey: input.liveSessionId,
    });
    const parsed = await this.parse('createLiveInput', response, CreatedLiveInputSchema);
    return { liveInputId: parsed.result.uid };
  }

  async getIngestCredentials(liveInputId: string): Promise<StreamIngestCredentials> {
    assertResourceId('live input', liveInputId);
    const response = await this.request(
      'getIngestCredentials',
      'GET',
      `/stream/live_inputs/${liveInputId}`,
    );
    const parsed = await this.parse('getIngestCredentials', response, LiveInputCredentialsSchema);
    return { rtmpsUrl: parsed.result.rtmps.url, streamKey: parsed.result.rtmps.streamKey };
  }

  /**
   * DELETE the live input. Cloudflare documents that this blocks current and future broadcasts
   * and that existing recordings are retained. 404 = already gone = success.
   */
  async retireLiveInput(liveInputId: string): Promise<void> {
    assertResourceId('live input', liveInputId);
    const response = await this.request(
      'retireLiveInput',
      'DELETE',
      `/stream/live_inputs/${liveInputId}`,
    );
    if (!response.ok && response.status !== 404) {
      throw await this.httpError('retireLiveInput', response);
    }
    // 404 = already gone. Success body is undocumented beyond `{}`; release the connection.
    await discardBody(response);
  }

  livePlayback(liveInputId: string): StreamPlayback {
    assertResourceId('live input', liveInputId);
    return playbackUrls(this.customerCode, liveInputId);
  }

  videoPlayback(videoId: string): StreamPlayback {
    assertResourceId('video', videoId);
    return playbackUrls(this.customerCode, videoId);
  }

  private async request(
    operation: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiToken}` };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;

    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(this.timeoutMs) };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);

    try {
      return await this.fetchImpl(`${API_BASE}/accounts/${this.accountId}${path}`, init);
    } catch (error) {
      // Network failure or timeout. The fetch error never carries request headers.
      throw new StreamProviderError(`Cloudflare Stream ${operation} failed: network error`, {
        retryable: true,
        cause: error,
      });
    }
  }

  private async parse<T extends z.ZodType>(
    operation: string,
    response: Response,
    schema: T,
  ): Promise<z.infer<T>> {
    if (!response.ok) throw await this.httpError(operation, response);
    const json = await readJson(operation, response);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // Do not echo the body: a credentials response contains the stream key.
      throw new StreamProviderError(
        `Cloudflare Stream ${operation} failed: unexpected response shape`,
        { status: response.status, retryable: false },
      );
    }
    return parsed.data;
  }

  private async httpError(operation: string, response: Response): Promise<StreamProviderError> {
    let body: unknown;
    try {
      body = await readJson(operation, response);
    } catch {
      // Unreadable error body: still report the status (and its retryability) below.
      body = undefined;
    }
    const parsed = ApiErrorEnvelopeSchema.safeParse(body);
    const detail = parsed.success
      ? parsed.data.errors
          .slice(0, 3)
          .map((e) => `${e.code} ${e.message.slice(0, 200)}`)
          .join('; ')
      : '';
    return new StreamProviderError(
      `Cloudflare Stream ${operation} failed: HTTP ${response.status}${detail ? ` (${detail})` : ''}`,
      { status: response.status, retryable: isRetryableStatus(response.status) },
    );
  }
}

/** 5xx, 408 Request Timeout and 429 Too Many Requests are transient; other 4xx are not. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * Reads and JSON-parses the body. A body read that fails (stalled/aborted stream, timeout) is
 * transient → retryable error, so a create whose response was lost mid-body is retried rather
 * than dead-lettered. Invalid JSON → `undefined` (the caller's schema check makes it non-retryable).
 */
async function readJson(operation: string, response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new StreamProviderError(
      `Cloudflare Stream ${operation} failed: response body unreadable`,
      { status: response.status, retryable: true, cause: error },
    );
  }
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to release.
  }
}
