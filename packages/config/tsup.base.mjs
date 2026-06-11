import { defineConfig } from 'tsup';

/**
 * Shared tsup preset for @repo/* packages: dual ESM+CJS + d.ts.
 * @param {import('tsup').Options} overrides
 */
export function tsupPreset(overrides = {}) {
  return defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    // incremental:true in tsconfig.base.json conflicts with tsup's DTS worker
    // (TS5074). Override it to false so the dts build is clean.
    dts: { compilerOptions: { incremental: false } },
    clean: true,
    sourcemap: true,
    treeshake: true,
    target: 'es2022',
    outDir: 'dist',
    ...overrides,
  });
}
