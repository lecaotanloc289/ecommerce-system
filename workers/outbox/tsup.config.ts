import { tsupPreset } from '@repo/config/tsup';
export default tsupPreset({
  entry: ['src/main.ts', 'src/retry-failed.ts'],
  format: ['esm'],
  dts: false,
});
