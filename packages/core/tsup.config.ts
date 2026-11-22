import { tsupPreset } from '@repo/config/tsup';

// One entry per public subpath (see package.json `exports`). `splitting` puts shared code
// (DomainError, schemas) in common chunks for BOTH formats, so `@repo/core` and
// `@repo/core/errors` resolve to the same class and `instanceof DomainError` holds.
export default tsupPreset({
  entry: [
    'src/index.ts',
    'src/money/index.ts',
    'src/pricing/index.ts',
    'src/errors/index.ts',
    'src/enums/index.ts',
    'src/ids/index.ts',
    'src/schemas/*.ts',
  ],
  splitting: true,
});
