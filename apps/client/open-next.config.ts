import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

// Read-only incremental cache served from the Worker's static assets: prerendered pages
// (the per-locale shells) are emitted at build time and never revalidated. No R2/KV needed.
// Switch to r2IncrementalCache (+ an R2 bucket in wrangler.jsonc) once pages use ISR /
// `revalidate` for API data. See https://opennext.js.org/cloudflare/caching
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
