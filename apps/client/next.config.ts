import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@repo/ui'],
  // `next build` (output: export) writes production manifests + `export-marker`
  // into `.next`; if `next dev` shares that dir it 404s on layout.css / chunks.
  // Dev runs with NEXT_DIST_DIR=.next-dev (package.json) so build (default
  // `.next`, export → `out/`) and dev never share a distDir.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
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
