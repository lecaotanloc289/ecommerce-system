import { ErrorParamsSchema, type ErrorParams } from '@repo/core';
import { translateError, type AppLocale } from '@repo/i18n';

/**
 * A non-2xx API reply. `errorCode` / `params` are the server's `{ errorCode, params }`
 * (translate with `translateError(locale, errorCode, params)`).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string | null,
    readonly params?: ErrorParams,
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

/** The `params` of an API error body (interpolation values), or undefined when absent/malformed. */
export function errorParamsOf(body: unknown): ErrorParams | undefined {
  if (typeof body !== 'object' || body === null || !('params' in body)) return undefined;
  const parsed = ErrorParamsSchema.safeParse(body.params);
  return parsed.success ? parsed.data : undefined;
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
    throw new ApiError(
      result.response.status,
      errorCodeOf(result.error),
      errorParamsOf(result.error),
    );
  }
  return schema.parse(result.data);
}

/** The `errorCode` of a thrown value: an `ApiError`'s code, else null. */
export function thrownErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.errorCode : null;
}

/** User-facing text for anything thrown by an API call (unknown / network errors → generic). */
export function describeError(locale: AppLocale, error: unknown): string {
  if (error instanceof ApiError) {
    return translateError(locale, error.errorCode ?? 'common.error.internal', error.params);
  }
  return translateError(locale, 'common.error.internal');
}
