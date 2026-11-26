/**
 * A handler failure that retrying cannot fix (invalid payload, provider refused the request,
 * provider not configured). The dispatcher dead-letters the event at once instead of backing off.
 * Any other thrown error is treated as transient and retried.
 */
export class PermanentError extends Error {
  override readonly name = 'PermanentError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
