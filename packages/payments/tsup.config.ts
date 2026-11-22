import { tsupPreset } from '@repo/config/tsup';

// One entry per public subpath (see package.json `exports`); `splitting` shares common chunks
// between the entries in both formats.
export default tsupPreset({
  entry: ['src/index.ts', 'src/vnpay/index.ts', 'src/stripe/index.ts'],
  splitting: true,
});
