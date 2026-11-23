import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for pure storefront logic (auth store, cart, query mapping, middleware matcher).
// Node environment: nothing here needs a DOM.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // next-intl's ESM imports `next/server` without an extension; let Vite resolve it.
    server: { deps: { inline: ['next-intl'] } },
  },
});
