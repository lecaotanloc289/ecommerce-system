import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * JSON logs to stdout (Fly collects them). Log ids (event, order, payment, user), never emails,
 * addresses or provider payloads; the redact list is a safety net, not a licence.
 */
export function createLogger(level: string): Logger {
  return pino({
    name: 'workers-jobs',
    level,
    redact: {
      paths: ['email', '*.email', 'to', '*.to', 'redirectUrl', '*.redirectUrl'],
      censor: '[redacted]',
    },
  });
}

const EMAIL_PATTERN = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[^\s@<>"'(),;:]+/g;

/**
 * One-line, PII-scrubbed description of a thrown value for logs and `outbox_events.last_error`
 * (SMTP rejections echo the recipient address). Capped at 1000 chars.
 */
export function describeError(error: unknown): string {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : 'Non-error thrown';
  return text.replace(EMAIL_PATTERN, '[email]').slice(0, 1000);
}
