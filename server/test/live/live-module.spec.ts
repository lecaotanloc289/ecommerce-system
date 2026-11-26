import { devLiveRoutesEnabled } from '../../src/live/live.module';
import { streamProviderConfig } from '../../src/live/stream-provider.provider';
import { testEnv } from '../helpers';

describe('LiveModule wiring', () => {
  it('registers dev routes only with the fake provider outside production', () => {
    expect(devLiveRoutesEnabled({})).toBe(true);
    expect(devLiveRoutesEnabled({ NODE_ENV: 'test', LIVE_STREAM_PROVIDER: 'fake' })).toBe(true);
    expect(devLiveRoutesEnabled({ NODE_ENV: 'development', LIVE_STREAM_PROVIDER: '' })).toBe(true);
    expect(devLiveRoutesEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(devLiveRoutesEnabled({ NODE_ENV: 'production', LIVE_STREAM_PROVIDER: 'fake' })).toBe(
      false,
    );
    expect(devLiveRoutesEnabled({ LIVE_STREAM_PROVIDER: 'cloudflare' })).toBe(false);
    expect(devLiveRoutesEnabled({ LIVE_STREAM_PROVIDER: 'bogus' })).toBe(false);
    expect(devLiveRoutesEnabled({ NODE_ENV: 'staging' })).toBe(false);
  });

  it('builds the provider config from env', () => {
    expect(streamProviderConfig(testEnv())).toEqual({ provider: 'fake' });
    expect(
      streamProviderConfig(
        testEnv({
          LIVE_STREAM_PROVIDER: 'cloudflare',
          CLOUDFLARE_STREAM_ACCOUNT_ID: 'acc',
          CLOUDFLARE_STREAM_API_TOKEN: 'tok',
          CLOUDFLARE_STREAM_CUSTOMER_CODE: 'abc',
          CLOUDFLARE_STREAM_WEBHOOK_SECRET: 's1',
          CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET: 's2',
        }),
      ),
    ).toEqual({ provider: 'cloudflare', accountId: 'acc', apiToken: 'tok', customerCode: 'abc' });
  });
});
