import type { MessageKey } from '@repo/i18n';

/** Message key of a form-field problem, translated by the caller (`t(key)`). */
export type FieldErrorKey = Extract<MessageKey, 'form.required' | 'form.tooLong' | 'form.invalid'>;

/** Field name → message key (first problem per field). */
export type FieldErrors<K extends string = string> = Partial<Record<K, FieldErrorKey>>;

/** The part of a `ZodError` this module reads (keeps `zod` out of the app's own dependencies). */
interface IssueSource {
  issues: ReadonlyArray<{ code: string; path: ReadonlyArray<PropertyKey> }>;
}

function keyFor(code: string): FieldErrorKey {
  if (code === 'too_big') return 'form.tooLong';
  // A blank string fails `min(1)` (too_small); a missing value is `invalid_type`.
  if (code === 'too_small' || code === 'invalid_type') return 'form.required';
  return 'form.invalid';
}

/**
 * Collapse Zod issues to one translatable key per top-level field. Core's own messages are
 * English text, so the UI never shows them (Golden Rule #7).
 */
export function fieldErrorsOf<K extends string>(
  error: IssueSource,
  fields: readonly K[],
): FieldErrors<K> {
  const out: FieldErrors<K> = {};
  for (const issue of error.issues) {
    const field = fields.find((f) => f === issue.path[0]);
    if (field !== undefined && out[field] === undefined) out[field] = keyFor(issue.code);
  }
  return out;
}
