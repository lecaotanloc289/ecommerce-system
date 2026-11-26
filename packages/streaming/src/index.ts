// Live video provider abstraction (Cloudflare Stream + in-memory fake) and webhook
// verification/parsing. No DB, no Nest, no workspace deps — see CLAUDE.md.
import { CloudflareStreamProvider, type FetchLike } from './cloudflare.js';
import { FakeStreamProvider } from './fake.js';
import type { StreamProvider } from './provider.js';

export {
  StreamProviderError,
  isStreamProviderError,
  type StreamIngestCredentials,
  type StreamPlayback,
  type StreamProvider,
} from './provider.js';
export {
  CloudflareStreamProvider,
  isRetryableStatus,
  type CloudflareStreamProviderOptions,
  type FetchLike,
} from './cloudflare.js';
export { FakeStreamProvider, type FakeLiveInput } from './fake.js';
export {
  NOTIFICATION_AUTH_HEADER,
  STREAM_SIGNATURE_HEADER,
  parseLiveInputNotification,
  parseStreamVideoWebhook,
  verifyNotificationWebhook,
  verifyStreamWebhookSignature,
  type LiveInputEvent,
  type LiveInputNotification,
  type StreamVideoWebhook,
  type VerifyStreamWebhookSignatureInput,
  type WebhookHeaders,
} from './webhooks.js';

/** Mirrors env `LIVE_STREAM_PROVIDER` (`fake` default | `cloudflare`). */
export type StreamProviderConfig =
  | { provider: 'fake'; customerCode?: string }
  | {
      provider: 'cloudflare';
      accountId: string;
      apiToken: string;
      customerCode: string;
      fetch?: FetchLike;
      timeoutMs?: number;
    };

export function createStreamProvider(config: StreamProviderConfig): StreamProvider {
  switch (config.provider) {
    case 'fake':
      return new FakeStreamProvider(
        config.customerCode === undefined ? {} : { customerCode: config.customerCode },
      );
    case 'cloudflare': {
      const { provider: _provider, ...options } = config;
      return new CloudflareStreamProvider(options);
    }
  }
}
