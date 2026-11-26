// @repo/e2e ESLint: the shared type-checked base from @repo/config.
import base from '@repo/config/eslint';

export default [
  ...base,
  { ignores: ['.tmp/**', 'playwright-report/**', 'test-results/**', '*.mjs'] },
];
