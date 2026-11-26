/** Shared per-project options. */
const base = {
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }] },
};

/**
 * Three projects:
 * - unit: everything under test/ except test/integration and `*.pg.spec.ts` — no Docker.
 * - integration: test/integration — Testcontainers Postgres 16 + Redis 7, started once per run by
 *   globalSetup (only when an integration spec is selected), one DB + Redis DB per Jest worker.
 *   See test/support/global-setup.ts.
 * - pg: `*.pg.spec.ts` (live shopping) — the live harness in test/integration/pg.ts with its own
 *   Postgres + Redis containers, started only when such a file is selected.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  // Containers pull/start on first run; integration specs share them.
  testTimeout: 60_000,
  projects: [
    {
      ...base,
      displayName: 'unit',
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.spec.ts'],
      testPathIgnorePatterns: [
        '/node_modules/',
        '<rootDir>/test/integration/',
        '\\.pg\\.spec\\.ts$',
      ],
    },
    {
      ...base,
      displayName: 'integration',
      roots: ['<rootDir>/test/integration'],
      testMatch: ['**/*.spec.ts'],
      testPathIgnorePatterns: ['/node_modules/', '\\.pg\\.spec\\.ts$'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
      globalTeardown: '<rootDir>/test/support/global-teardown.ts',
      setupFiles: ['<rootDir>/test/support/integration-env.ts'],
    },
    {
      ...base,
      displayName: 'pg',
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.pg.spec.ts'],
      globalSetup: '<rootDir>/test/integration/pg.global-setup.ts',
      globalTeardown: '<rootDir>/test/integration/pg.global-teardown.ts',
      setupFiles: ['<rootDir>/test/integration/pg.worker-env.ts'],
    },
  ],
};
