import { ulid } from 'ulid';

/**
 * One `Idempotency-Key` per user action (Golden Rule #3).
 *
 * A "user action" is a submit with a given set of variables. Every attempt at it — TanStack
 * Query's automatic retry, or the user pressing the button again after a network error or a 5xx
 * — reuses the same key, so the server replays instead of executing twice. The key is dropped
 * once the action succeeds, or when the variables change (the server would answer
 * `idempotency.error.key-reused` for a different body under the same key). The server never caches
 * errors, so keeping the key after a failure is always safe.
 */
export interface IdempotencyKeyTracker {
  /** Key for an attempt with these variables: the pending action's key, or a fresh ULID. */
  keyFor: (variables: unknown) => string;
  /** The action succeeded: the next submit is a new action with a new key. */
  succeeded: () => void;
  /** Forget the pending action (e.g. the form was reset). */
  reset: () => void;
}

export function createIdempotencyKeyTracker(newKey: () => string = ulid): IdempotencyKeyTracker {
  let pending: { fingerprint: string; key: string } | null = null;

  return {
    keyFor(variables) {
      const fingerprint = stableStringify(variables);
      if (pending?.fingerprint !== fingerprint) pending = { fingerprint, key: newKey() };
      return pending.key;
    },
    succeeded() {
      pending = null;
    },
    reset() {
      pending = null;
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
