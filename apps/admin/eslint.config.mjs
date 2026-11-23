// @apps/admin ESLint: the shared type-checked base from @repo/config + React hooks rules.
// The project service picks the nearest tsconfig per file (src + test → tsconfig.json).
import base from '@repo/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  ...base,
  // `.tsc-node-out/` = declarations emitted by `tsc -b` for the vite/vitest configs.
  // `dist-e2e/` = the build `pnpm e2e` serves (see e2e/CLAUDE.md).
  { ignores: ['dist/**', 'dist-e2e/**', '.tsc-node-out/**', '*.mjs', '*.config.ts'] },
  reactHooks.configs.flat['recommended-latest'],
];
