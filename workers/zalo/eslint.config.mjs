// Zalo worker ESLint: the shared type-checked base from @repo/config (src → tsconfig.json,
// test → test/tsconfig.json via the project service).
import base from '@repo/config/eslint';

export default [...base, { ignores: ['dist/**', '*.mjs', 'vitest.config.ts', 'tsup.config.ts'] }];
