import type { ErrorCode } from '@repo/core';

/**
 * `DomainError` codes from `@repo/payments` adapters that a retry cannot fix (see
 * packages/payments/CLAUDE.md) → the handler dead-letters. Anything else (notably
 * `payment.error.provider-unavailable`) is retried with backoff.
 */
export const PERMANENT_PROVIDER_ERRORS: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'common.error.validation-failed',
  'money.error.currency-mismatch',
  'money.error.invalid-operand',
  'payment.error.amount-mismatch',
]);
