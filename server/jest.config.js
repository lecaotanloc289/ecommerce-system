/** @type {import('jest').Config['projects'][number]} */
const base = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }] },
};

/** @type {import('jest').Config} */
module.exports = {
  // Testcontainers pulls/starts Redis/Postgres on first run.
  testTimeout: 60_000,
  projects: [
    {
      ...base,
      displayName: 'unit',
      testMatch: ['**/*.spec.ts'],
      testPathIgnorePatterns: ['/node_modules/', '\\.pg\\.spec\\.ts$'],
    },
    {
      // `*.pg.spec.ts` = real Postgres + Redis (see test/integration/pg.ts). The containers start
      // only when at least one such file is selected.
      ...base,
      displayName: 'pg',
      testMatch: ['**/*.pg.spec.ts'],
      globalSetup: '<rootDir>/test/integration/pg.global-setup.ts',
      globalTeardown: '<rootDir>/test/integration/pg.global-teardown.ts',
      setupFiles: ['<rootDir>/test/integration/pg.worker-env.ts'],
    },
  ],
};
