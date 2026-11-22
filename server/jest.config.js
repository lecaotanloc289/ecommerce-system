/** Shared per-project options. */
const base = {
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }] },
};

/**
 * Two projects:
 * - unit: everything under test/ except test/integration — no Docker.
 * - integration: test/integration — Testcontainers Postgres 16 + Redis 7, started once per run by
 *   globalSetup (only when an integration spec is selected), one DB + Redis DB per Jest worker.
 *   See test/support/global-setup.ts.
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
      testPathIgnorePatterns: ['/node_modules/', '<rootDir>/test/integration/'],
    },
    {
      ...base,
      displayName: 'integration',
      roots: ['<rootDir>/test/integration'],
      testMatch: ['**/*.spec.ts'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
      globalTeardown: '<rootDir>/test/support/global-teardown.ts',
      setupFiles: ['<rootDir>/test/support/integration-env.ts'],
    },
  ],
};
