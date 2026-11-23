// Build-time config. Anything `VITE_*` is inlined into the public bundle — never put secrets here.

const DEFAULT_API_URL = 'http://localhost:3001';

/**
 * API origin for `@repo/sdk` (generated paths already start with `/v1`). A trailing `/v1` or `/`
 * is stripped so `VITE_API_URL=http://localhost:3001/v1` does not produce `/v1/v1/...`.
 */
export function normalizeApiUrl(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_API_URL;
  return value.replace(/\/+$/, '').replace(/\/v1$/, '');
}

export const env = {
  apiUrl: normalizeApiUrl(import.meta.env.VITE_API_URL),
} as const;
