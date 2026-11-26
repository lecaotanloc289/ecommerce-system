import { describe, expect, it, vi } from 'vitest';
import {
  CloudflareStreamProvider,
  StreamProviderError,
  isRetryableStatus,
  type FetchLike,
} from '../src/index.js';
import { fixture } from './fixtures.js';

const ACCOUNT_ID = '023e105f4ecef8ad9ca31a8372d0c353';
const API_TOKEN = 'super-secret-token-value';
const CUSTOMER_CODE = 'abc123';
const LIVE_INPUT_ID = '66be4bf738797e01e1fca35a7bdecdcd';
const SESSION_ID = '01JH0000000000000000000000';
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/stream/live_inputs`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(respond: () => Response | Promise<Response>) {
  const fetchMock = vi.fn<FetchLike>(async () => respond());
  const provider = new CloudflareStreamProvider({
    accountId: ACCOUNT_ID,
    apiToken: API_TOKEN,
    customerCode: CUSTOMER_CODE,
    fetch: fetchMock,
  });
  return { provider, fetchMock };
}

function lastCall(fetchMock: ReturnType<typeof vi.fn<FetchLike>>) {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  const [url, init] = call;
  return { url, init, headers: new Headers(init.headers) };
}

async function rejection(promise: Promise<unknown>): Promise<StreamProviderError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof StreamProviderError)) throw new Error('expected StreamProviderError');
  return error;
}

describe('CloudflareStreamProvider.createLiveInput', () => {
  it('POSTs an automatic-recording input named after the session', async () => {
    const { provider, fetchMock } = setup(() => jsonResponse(fixture('live-input-created')));

    await expect(provider.createLiveInput({ liveSessionId: SESSION_ID })).resolves.toEqual({
      liveInputId: 'f256e6ea9341d51eea64c9454659e576',
    });

    const { url, init, headers } = lastCall(fetchMock);
    expect(url).toBe(BASE);
    expect(init.method).toBe('POST');
    expect(headers.get('authorization')).toBe(`Bearer ${API_TOKEN}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('idempotency-key')).toBe(SESSION_ID);
    expect(JSON.parse(String(init.body))).toEqual({
      meta: { name: SESSION_ID },
      recording: { mode: 'automatic' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects a response without a valid uid (non-retryable)', async () => {
    const { provider } = setup(() => jsonResponse({ success: true, result: { uid: '../x' } }));
    const error = await rejection(provider.createLiveInput({ liveSessionId: SESSION_ID }));
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(200);
    expect(error.message).toMatch(/unexpected response shape/);
  });

  it('rejects success:false with a 200', async () => {
    const { provider } = setup(() => jsonResponse(fixture('api-error-not-found')));
    const error = await rejection(provider.createLiveInput({ liveSessionId: SESSION_ID }));
    expect(error.retryable).toBe(false);
  });

  it('rejects a non-JSON body', async () => {
    const { provider } = setup(() => new Response('<html>oops</html>', { status: 200 }));
    const error = await rejection(provider.createLiveInput({ liveSessionId: SESSION_ID }));
    expect(error.retryable).toBe(false);
  });

  it('treats a body that fails mid-read as retryable (input may exist; retry, do not dead-letter)', async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new DOMException('The operation timed out.', 'TimeoutError'));
      },
    });
    const { provider } = setup(() => new Response(stalled, { status: 200 }));
    const error = await rejection(provider.createLiveInput({ liveSessionId: SESSION_ID }));
    expect(error.retryable).toBe(true);
    expect(error.status).toBe(200);
    expect(error.message).toMatch(/body unreadable/);
  });

  it('rejects an empty session id without calling Cloudflare', async () => {
    const { provider, fetchMock } = setup(() => jsonResponse(fixture('live-input-created')));
    const error = await rejection(provider.createLiveInput({ liveSessionId: '' }));
    expect(error.retryable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('CloudflareStreamProvider.getIngestCredentials', () => {
  it('GETs the input and returns rtmps url + stream key', async () => {
    const { provider, fetchMock } = setup(() => jsonResponse(fixture('live-input-get')));

    await expect(provider.getIngestCredentials(LIVE_INPUT_ID)).resolves.toEqual({
      rtmpsUrl: 'rtmps://live.cloudflare.com:443/live/',
      streamKey: '2fb3cb9f17e68a2568d6ebed8d5505eak66be4bf738797e01e1fca35a7bdecdcd',
    });

    const { url, init, headers } = lastCall(fetchMock);
    expect(url).toBe(`${BASE}/${LIVE_INPUT_ID}`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(headers.get('authorization')).toBe(`Bearer ${API_TOKEN}`);
    expect(headers.has('content-type')).toBe(false);
  });

  it('rejects a response missing the stream key without echoing the body', async () => {
    const { provider } = setup(() =>
      jsonResponse({
        success: true,
        result: { uid: LIVE_INPUT_ID, rtmps: { url: 'rtmps://live.cloudflare.com:443/live/' } },
      }),
    );
    const error = await rejection(provider.getIngestCredentials(LIVE_INPUT_ID));
    expect(error.retryable).toBe(false);
    expect(error.message).not.toContain('rtmps://');
  });

  it('rejects a non-rtmps ingest url', async () => {
    const { provider } = setup(() =>
      jsonResponse({
        success: true,
        result: { uid: LIVE_INPUT_ID, rtmps: { url: 'http://evil.test/', streamKey: 'k' } },
      }),
    );
    await expect(provider.getIngestCredentials(LIVE_INPUT_ID)).rejects.toBeInstanceOf(
      StreamProviderError,
    );
  });

  it.each(['', '../../accounts', 'a/b', 'x'.repeat(33)])(
    'refuses unsafe id %j without calling Cloudflare',
    async (id) => {
      const { provider, fetchMock } = setup(() => jsonResponse(fixture('live-input-get')));
      const error = await rejection(provider.getIngestCredentials(id));
      expect(error.retryable).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

describe('CloudflareStreamProvider error mapping', () => {
  it.each([
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [408, true],
    [409, false],
    [429, true],
    [500, true],
    [502, true],
    [503, true],
  ])('HTTP %i → retryable=%s', async (status, retryable) => {
    const { provider } = setup(() => jsonResponse(fixture('api-error-not-found'), status));
    const error = await rejection(provider.getIngestCredentials(LIVE_INPUT_ID));
    expect(error.status).toBe(status);
    expect(error.retryable).toBe(retryable);
    expect(error.message).toContain(`HTTP ${status}`);
    expect(error.message).toContain('10003 Not Found');
    expect(isRetryableStatus(status)).toBe(retryable);
  });

  it('maps a network failure to retryable without a status', async () => {
    const { provider } = setup(() => {
      throw new TypeError('fetch failed');
    });
    const error = await rejection(provider.createLiveInput({ liveSessionId: SESSION_ID }));
    expect(error.retryable).toBe(true);
    expect(error.status).toBeUndefined();
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it('maps a timeout to retryable', async () => {
    const provider = new CloudflareStreamProvider({
      accountId: ACCOUNT_ID,
      apiToken: API_TOKEN,
      customerCode: CUSTOMER_CODE,
      timeoutMs: 5,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    const error = await rejection(provider.getIngestCredentials(LIVE_INPUT_ID));
    expect(error.retryable).toBe(true);
  });

  it('handles a non-JSON error body', async () => {
    const { provider } = setup(() => new Response('Bad Gateway', { status: 502 }));
    const error = await rejection(provider.getIngestCredentials(LIVE_INPUT_ID));
    expect(error.message).toBe('Cloudflare Stream getIngestCredentials failed: HTTP 502');
    expect(error.retryable).toBe(true);
  });

  it('never puts the API token in an error message', async () => {
    const { provider } = setup(() =>
      jsonResponse(
        { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
        403,
      ),
    );
    const error = await rejection(provider.getIngestCredentials(LIVE_INPUT_ID));
    expect(error.message).not.toContain(API_TOKEN);
    expect(JSON.stringify(error)).not.toContain(API_TOKEN);
  });
});

describe('CloudflareStreamProvider.retireLiveInput', () => {
  it('DELETEs the input', async () => {
    const { provider, fetchMock } = setup(() => jsonResponse({}));
    await expect(provider.retireLiveInput(LIVE_INPUT_ID)).resolves.toBeUndefined();
    const { url, init, headers } = lastCall(fetchMock);
    expect(url).toBe(`${BASE}/${LIVE_INPUT_ID}`);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(headers.get('authorization')).toBe(`Bearer ${API_TOKEN}`);
  });

  it('accepts an empty 204-style body', async () => {
    const { provider } = setup(() => new Response(null, { status: 204 }));
    await expect(provider.retireLiveInput(LIVE_INPUT_ID)).resolves.toBeUndefined();
  });

  it('treats 404 as already retired', async () => {
    const { provider } = setup(() => jsonResponse(fixture('api-error-not-found'), 404));
    await expect(provider.retireLiveInput(LIVE_INPUT_ID)).resolves.toBeUndefined();
  });

  it('propagates other failures with retry hints', async () => {
    const { provider } = setup(() => jsonResponse({ success: false, errors: [] }, 503));
    const error = await rejection(provider.retireLiveInput(LIVE_INPUT_ID));
    expect(error.retryable).toBe(true);
    expect(error.status).toBe(503);
  });
});

describe('CloudflareStreamProvider playback (pure)', () => {
  it('builds live HLS + iframe URLs without network', () => {
    const { provider, fetchMock } = setup(() => jsonResponse({}));
    expect(provider.livePlayback(LIVE_INPUT_ID)).toEqual({
      hlsUrl: `https://customer-abc123.cloudflarestream.com/${LIVE_INPUT_ID}/manifest/video.m3u8`,
      iframeUrl: `https://customer-abc123.cloudflarestream.com/${LIVE_INPUT_ID}/iframe`,
    });
    expect(provider.videoPlayback('6b9e68b07dfee8cc2d116e4c51d6a957')).toEqual({
      hlsUrl:
        'https://customer-abc123.cloudflarestream.com/6b9e68b07dfee8cc2d116e4c51d6a957/manifest/video.m3u8',
      iframeUrl:
        'https://customer-abc123.cloudflarestream.com/6b9e68b07dfee8cc2d116e4c51d6a957/iframe',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an unsafe id', () => {
    const { provider } = setup(() => jsonResponse({}));
    expect(() => provider.videoPlayback('a/b')).toThrow(StreamProviderError);
  });
});

describe('CloudflareStreamProvider constructor', () => {
  it.each([
    { accountId: 'not/valid', apiToken: API_TOKEN, customerCode: CUSTOMER_CODE },
    { accountId: ACCOUNT_ID, apiToken: '', customerCode: CUSTOMER_CODE },
    { accountId: ACCOUNT_ID, apiToken: API_TOKEN, customerCode: 'evil.com/x' },
  ])('rejects invalid config %#', (options) => {
    expect(() => new CloudflareStreamProvider(options)).toThrow(StreamProviderError);
  });
});
