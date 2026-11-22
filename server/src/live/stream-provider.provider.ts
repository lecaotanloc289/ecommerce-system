import type { FactoryProvider } from '@nestjs/common';
import {
  createStreamProvider,
  type StreamProvider,
  type StreamProviderConfig,
} from '@repo/streaming';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** Injection token for the live video provider: `@Inject(STREAM_PROVIDER) stream: StreamProvider`. */
export const STREAM_PROVIDER = Symbol('STREAM_PROVIDER');

export function streamProviderConfig(env: Env): StreamProviderConfig {
  if (env.LIVE_STREAM_PROVIDER === 'fake') return { provider: 'fake' };
  const {
    CLOUDFLARE_STREAM_ACCOUNT_ID: accountId,
    CLOUDFLARE_STREAM_API_TOKEN: apiToken,
    CLOUDFLARE_STREAM_CUSTOMER_CODE: customerCode,
  } = env;
  // parseEnv already requires these for `cloudflare`; this narrows the types.
  if (!accountId || !apiToken || !customerCode) {
    throw new Error('Cloudflare Stream env is incomplete');
  }
  return { provider: 'cloudflare', accountId, apiToken, customerCode };
}

export const streamProviderProvider: FactoryProvider<StreamProvider> = {
  provide: STREAM_PROVIDER,
  inject: [ENV],
  useFactory: (env: Env) => createStreamProvider(streamProviderConfig(env)),
};
