import { translateError, type AppLocale } from '@repo/i18n';
import { ApiError } from './errors';

/** The `errorCode` of an `ApiError`, or null for anything else (network failure, parse error). */
export function errorCodeOfThrown(error: unknown): string | null {
  return error instanceof ApiError ? error.errorCode : null;
}

/** User-facing text for a failed call: the API's `errorCode` translated, else the generic message. */
export function describeError(locale: AppLocale, error: unknown): string {
  return translateError(locale, errorCodeOfThrown(error) ?? 'common.error.internal');
}
