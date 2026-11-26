import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

// SSR on Cloudflare Workers via @opennextjs/cloudflare (`pnpm preview` / `pnpm deploy`).
// Locale routing (`/vi`, `/en`) comes from next-intl — see src/i18n/routing.ts + src/middleware.ts.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@repo/ui'],
};

export default withNextIntl(config);

// Exposes Cloudflare bindings (getCloudflareContext) to `next dev`.
void initOpenNextCloudflareForDev();
