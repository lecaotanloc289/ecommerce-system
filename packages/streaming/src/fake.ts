import { createHash } from 'node:crypto';
import {
  assertResourceId,
  CustomerCodeSchema,
  playbackUrls,
  StreamProviderError,
  type StreamIngestCredentials,
  type StreamPlayback,
  type StreamProvider,
} from './provider.js';

export interface FakeLiveInput {
  liveSessionId: string;
  isRetired: boolean;
}

/**
 * In-memory provider for local dev and tests. Deterministic: the live input id is derived from
 * the session id, so creating twice for the same session returns the same input. Mirrors
 * Cloudflare's observable behaviour: a retired (deleted) input 404s on credential reads, and
 * retiring an unknown or retired input succeeds.
 */
export class FakeStreamProvider implements StreamProvider {
  private readonly customerCode: string;
  private readonly inputs = new Map<string, FakeLiveInput>();

  constructor(options: { customerCode?: string } = {}) {
    const customerCode = options.customerCode ?? 'fake';
    if (!CustomerCodeSchema.safeParse(customerCode).success) {
      throw new StreamProviderError('Invalid customer code', { retryable: false });
    }
    this.customerCode = customerCode;
  }

  async createLiveInput(input: { liveSessionId: string }): Promise<{ liveInputId: string }> {
    if (input.liveSessionId.length === 0) {
      throw new StreamProviderError('Invalid live session id', { retryable: false });
    }
    const liveInputId = createHash('sha256').update(input.liveSessionId).digest('hex').slice(0, 32);
    if (!this.inputs.has(liveInputId)) {
      this.inputs.set(liveInputId, { liveSessionId: input.liveSessionId, isRetired: false });
    }
    return { liveInputId };
  }

  async getIngestCredentials(liveInputId: string): Promise<StreamIngestCredentials> {
    assertResourceId('live input', liveInputId);
    const input = this.inputs.get(liveInputId);
    if (!input || input.isRetired) {
      throw new StreamProviderError('Fake stream getIngestCredentials failed: HTTP 404', {
        status: 404,
        retryable: false,
      });
    }
    return {
      rtmpsUrl: 'rtmps://live.fake.invalid:443/live/',
      streamKey: `fake-key-${liveInputId}`,
    };
  }

  async retireLiveInput(liveInputId: string): Promise<void> {
    assertResourceId('live input', liveInputId);
    const input = this.inputs.get(liveInputId);
    if (input) input.isRetired = true;
  }

  livePlayback(liveInputId: string): StreamPlayback {
    assertResourceId('live input', liveInputId);
    return playbackUrls(this.customerCode, liveInputId);
  }

  videoPlayback(videoId: string): StreamPlayback {
    assertResourceId('video', videoId);
    return playbackUrls(this.customerCode, videoId);
  }

  /** Test helper: a snapshot of what the fake knows about an input, or `undefined`. */
  inspectLiveInput(liveInputId: string): FakeLiveInput | undefined {
    const input = this.inputs.get(liveInputId);
    return input ? { ...input } : undefined;
  }
}
