import { ErrorParamsSchema, type ErrorParams } from '@repo/core';
import { createTranslator, translateError, type AppLocale } from '@repo/i18n';

/**
 * A non-2xx API response. `errorCode` stays a plain string: a server newer than this bundle may
 * send a code it does not know — `translateError` falls back to the generic message.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly errorCode: string,
    readonly params: ErrorParams = {},
  ) {
    super(`API ${status}: ${errorCode}`);
  }
}

/** Build an `ApiError` from a response body (`{ errorCode, params }`, core `ErrorResponseSchema`). */
export function toApiError(status: number, body: unknown): ApiError {
  if (typeof body === 'object' && body !== null && 'errorCode' in body) {
    const { errorCode } = body;
    const params = 'params' in body ? ErrorParamsSchema.safeParse(body.params) : null;
    if (typeof errorCode === 'string') {
      return new ApiError(status, errorCode, params?.success ? params.data : {});
    }
  }
  return new ApiError(status, 'common.error.internal');
}

interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * `const product = await unwrap(api.GET('/v1/...'))` — returns `data` or throws an `ApiError`,
 * which is what TanStack Query `queryFn` / `mutationFn` expect. Not for 204 routes (no body).
 */
export async function unwrap<T>(request: Promise<ApiResult<T>>): Promise<T> {
  const { data, error, response } = await request;
  if (!response.ok || error !== undefined) throw toApiError(response.status, error);
  if (data === undefined) throw new ApiError(response.status, 'common.error.internal');
  return data;
}

/**
 * Worth retrying automatically: offline / CORS (`fetch` rejects with `TypeError`), 5xx, 429, and
 * an idempotent request still running server-side. Any other 4xx is a definite answer.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!(error instanceof ApiError)) return false;
  return (
    error.status >= 500 ||
    error.status === 429 ||
    error.errorCode === 'idempotency.error.in-progress'
  );
}

/** TanStack Query `retry` option: up to 2 retries, transient failures only. */
export function retryTransient(failureCount: number, error: unknown): boolean {
  return failureCount < 2 && isTransientError(error);
}

/**
 * User-facing text for anything a query or mutation can throw: an `ApiError` is translated from
 * its `errorCode` + `params`; a `fetch` rejection (offline, CORS, DNS) gets the network message.
 */
export function errorMessage(locale: AppLocale, error: unknown): string {
  if (error instanceof ApiError) return translateError(locale, error.errorCode, error.params);
  if (error instanceof TypeError) return createTranslator(locale)('admin.error.network');
  return translateError(locale, 'common.error.internal');
}
