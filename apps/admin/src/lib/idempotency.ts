import { ulid } from 'ulid';

/**
 * One `Idempotency-Key` per user action (Golden Rule #3).
 *
 * A "user action" is a submit with a given set of variables. Every attempt at it — TanStack
 * Query's automatic retry, or the user pressing the button again after a network error or a 5xx
 * — reuses the same key, so the server replays instead of executing twice. Different variables
 * are a different action with their own key (the server would answer
 * `idempotency.error.key-reused` for a different body under the same key), and actions in flight
 * at the same time (`mutate(a)` then `mutate(b)`) keep separate keys. A key is dropped once its
 * action succeeds. The server never caches errors, so keeping a key after a failure is safe.
 */
export interface IdempotencyKeyTracker {
  /** Key for an attempt with these variables: the pending action's key, or a fresh ULID. */
  keyFor: (variables: unknown) => string;
  /** The action with these variables succeeded: submitting them again is a new action. */
  succeeded: (variables: unknown) => void;
  /** Forget every pending action (e.g. the form was reset). */
  reset: () => void;
}

export function createIdempotencyKeyTracker(newKey: () => string = ulid): IdempotencyKeyTracker {
  const pending = new Map<string, string>(); // fingerprint → key

  return {
    keyFor(variables) {
      const fingerprint = stableStringify(variables);
      const existing = pending.get(fingerprint);
      if (existing !== undefined) return existing;
      const key = newKey();
      pending.set(fingerprint, key);
      return key;
    },
    succeeded(variables) {
      pending.delete(stableStringify(variables));
    },
    reset() {
      pending.clear();
    },
  };
}

/** JSON with object keys sorted, so `{a, b}` and `{b, a}` are the same action. */
export function stableStringify(value: unknown): string {
  return (
    JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
      const entries: [string, unknown][] = Object.entries(v);
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(entries);
    }) ?? 'undefined'
  );
}
