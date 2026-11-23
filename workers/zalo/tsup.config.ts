import { tsupPreset } from '@repo/config/tsup';

export default tsupPreset({
  entry: ['src/main.ts'],
  format: ['esm'],
  dts: false,
});
