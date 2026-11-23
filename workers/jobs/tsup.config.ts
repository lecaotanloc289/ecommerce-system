import { defineConfig } from 'tsup';

// A runnable Node app, not a library: one ESM entry, no d.ts. Dependencies (workspace packages,
// @prisma/client via @repo/db, bullmq, nodemailer, pino) stay external and resolve from
// node_modules at runtime.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
});
