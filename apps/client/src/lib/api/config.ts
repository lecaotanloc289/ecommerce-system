/** Local API origin used when no env var is set outside production (`pnpm dev`). */
const DEV_API_ORIGIN = 'http://localhost:3001';

/**
 * API origin WITHOUT the `/v1` prefix (the generated SDK paths already start with `/v1`).
 * A trailing slash or `/v1` in the env value is tolerated and stripped.
 */
export function normalizeApiOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

function resolve(value: string | undefined, name: string): string {
  if (value && value.trim()) return normalizeApiOrigin(value);
  if (process.env.NODE_ENV !== 'production') return DEV_API_ORIGIN;
  throw new Error(`${name} is not set — the storefront cannot reach the API`);
}

/**
 * Browser-side API origin. `NEXT_PUBLIC_API_URL` is inlined at build time, so it must be a
 * literal `process.env.NEXT_PUBLIC_API_URL` access (no dynamic lookup).
 */
export function browserApiOrigin(): string {
  return resolve(process.env.NEXT_PUBLIC_API_URL, 'NEXT_PUBLIC_API_URL');
}

/**
 * Server-side (RSC / route handler) API origin: `API_URL` when set (e.g. an internal address the
 * Worker can reach), else the public `NEXT_PUBLIC_API_URL`. Read at request time.
 */
export function serverApiOrigin(): string {
  // `||`: an empty API_URL (set but blank) falls back too.
  return resolve(process.env.API_URL || process.env.NEXT_PUBLIC_API_URL, 'API_URL');
}
