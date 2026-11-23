import { defineConfig, devices } from '@playwright/test';
import { ORIGINS } from './support/config';

// The stack (API, worker, storefront, admin, DB, Redis) is booted by `scripts/run.ts`, not by
// Playwright's `webServer`: the database has to exist and be seeded before the API starts.
// Flows share one database and mutate it (stock, orders, wallets), so they run serially, in
// file order, in a single worker.
const channel = process.env.E2E_BROWSER_CHANNEL;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: ORIGINS.web,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    ...devices['Desktop Chrome'],
    ...(channel ? { channel } : {}),
  },
});
