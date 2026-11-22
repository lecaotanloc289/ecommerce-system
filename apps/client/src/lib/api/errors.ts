/** A non-2xx API reply. `errorCode` is the server's `{ errorCode }` (translate with `translateError`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string | null,
  ) {
    super(`API request failed with ${status}${errorCode ? ` (${errorCode})` : ''}`);
    this.name = 'ApiError';
  }
}

/**
 * The `errorCode` of an API error body (core `ErrorResponse`), or null when there is none. Kept as a
 * plain string: a newer server may send a code this bundle doesn't know (`translateError` falls back).
 */
export function errorCodeOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('errorCode' in body)) return null;
  return typeof body.errorCode === 'string' && body.errorCode ? body.errorCode : null;
}

/** Anything with a Zod-like `parse` — the response schemas re-exported by `@repo/core` / `@repo/sdk`. */
export interface ResponseSchema<T> {
  parse(input: unknown): T;
}

/** Result shape of every openapi-fetch call. */
export interface FetchResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

/**
 * Validate a successful reply through its core schema (branded ids, Money shape), or throw an
 * `ApiError` for a non-2xx reply.
 */
export function parseResult<T>(result: FetchResult, schema: ResponseSchema<T>): T {
  if (!result.response.ok) {
    throw new ApiError(result.response.status, errorCodeOf(result.error));
  }
  return schema.parse(result.data);
}
