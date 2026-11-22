// @workers/jobs ESLint: the shared type-checked base from @repo/config. The project service picks
// the nearest tsconfig per file (src → tsconfig.json, test → test/tsconfig.json).
import base from '@repo/config/eslint';

export default [...base, { ignores: ['dist/**', '*.mjs', '*.config.ts'] }];
