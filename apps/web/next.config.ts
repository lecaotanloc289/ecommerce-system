import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@repo/ui'],
  // Static export → `out/` directory. Cloudflare Pages hosts the static
  // artifact directly. Switch to @opennextjs/cloudflare + Workers when the
  // app starts using Server Components data fetching, middleware, or API
  // routes that need runtime execution.
  output: 'export',
  images: { unoptimized: true },
  // Trailing slash makes static hosts happier with nested routes.
  trailingSlash: true,
};

export default config;
