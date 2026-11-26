import { describe, expect, it } from 'vitest';
import {
  CloudflareStreamProvider,
  FakeStreamProvider,
  StreamProviderError,
  createStreamProvider,
  isStreamProviderError,
} from '../src/index.js';

const SESSION_ID = '01JH0000000000000000000000';

describe('FakeStreamProvider', () => {
  it('is deterministic and idempotent per session', async () => {
    const a = new FakeStreamProvider();
    const b = new FakeStreamProvider();
    const first = await a.createLiveInput({ liveSessionId: SESSION_ID });
    expect(first.liveInputId).toMatch(/^[0-9a-f]{32}$/);
    await expect(a.createLiveInput({ liveSessionId: SESSION_ID })).resolves.toEqual(first);
    await expect(b.createLiveInput({ liveSessionId: SESSION_ID })).resolves.toEqual(first);
    const other = await a.createLiveInput({ liveSessionId: '01JH0000000000000000000001' });
    expect(other.liveInputId).not.toBe(first.liveInputId);
    expect(a.inspectLiveInput(first.liveInputId)).toEqual({
      liveSessionId: SESSION_ID,
      isRetired: false,
    });
  });

  it('returns credentials until retired, then 404s', async () => {
    const fake = new FakeStreamProvider();
    const { liveInputId } = await fake.createLiveInput({ liveSessionId: SESSION_ID });
    await expect(fake.getIngestCredentials(liveInputId)).resolves.toEqual({
      rtmpsUrl: 'rtmps://live.fake.invalid:443/live/',
      streamKey: `fake-key-${liveInputId}`,
    });

    await fake.retireLiveInput(liveInputId);
    await fake.retireLiveInput(liveInputId); // idempotent
    expect(fake.inspectLiveInput(liveInputId)?.isRetired).toBe(true);

    const error = await fake.getIngestCredentials(liveInputId).catch((e: unknown) => e);
    expect(isStreamProviderError(error)).toBe(true);
    expect(error).toMatchObject({ status: 404, retryable: false });
  });

  it('retiring an unknown input succeeds (Cloudflare 404 = done)', async () => {
    await expect(
      new FakeStreamProvider().retireLiveInput('0123456789abcdef0123456789abcdef'),
    ).resolves.toBeUndefined();
  });

  it('rejects invalid ids as StreamProviderError (async methods reject, not throw)', async () => {
    const fake = new FakeStreamProvider();
    await expect(fake.createLiveInput({ liveSessionId: '' })).rejects.toBeInstanceOf(
      StreamProviderError,
    );
    await expect(fake.getIngestCredentials('a/b')).rejects.toBeInstanceOf(StreamProviderError);
    await expect(fake.retireLiveInput('a/b')).rejects.toBeInstanceOf(StreamProviderError);
  });

  it('builds playback URLs with the "fake" customer code by default', () => {
    expect(new FakeStreamProvider().livePlayback('abc')).toEqual({
      hlsUrl: 'https://customer-fake.cloudflarestream.com/abc/manifest/video.m3u8',
      iframeUrl: 'https://customer-fake.cloudflarestream.com/abc/iframe',
    });
    expect(new FakeStreamProvider({ customerCode: 'demo' }).videoPlayback('v1').iframeUrl).toBe(
      'https://customer-demo.cloudflarestream.com/v1/iframe',
    );
  });
});

describe('createStreamProvider', () => {
  it('builds a fake', () => {
    expect(createStreamProvider({ provider: 'fake' })).toBeInstanceOf(FakeStreamProvider);
  });

  it('builds a Cloudflare provider', () => {
    const provider = createStreamProvider({
      provider: 'cloudflare',
      accountId: '023e105f4ecef8ad9ca31a8372d0c353',
      apiToken: 'token',
      customerCode: 'abc123',
    });
    expect(provider).toBeInstanceOf(CloudflareStreamProvider);
    expect(provider.livePlayback('abc').iframeUrl).toBe(
      'https://customer-abc123.cloudflarestream.com/abc/iframe',
    );
  });
});
