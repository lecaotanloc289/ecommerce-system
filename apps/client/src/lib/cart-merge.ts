import type { CartLineInput, CartMergeAdjustment, CartMergeResult } from '@repo/core';
import { newIdempotencyKey as newUlid } from './idempotency';

/** The pending merge's idempotency key, bound to the lines it was generated for. */
export interface PendingMerge {
  key: string;
  fingerprint: string;
}

export interface MergeKeyStore {
  get(): PendingMerge | null;
  set(pending: PendingMerge | null): void;
}

export interface CartMergerDeps {
  /** `POST /v1/cart/merge` with the given `Idempotency-Key`. */
  post: (items: CartLineInput[], idempotencyKey: string) => Promise<CartMergeResult>;
  keys: MergeKeyStore;
  newKey?: () => string;
}

/** Order-independent identity of a set of guest lines (duplicates are summed server-side). */
export function fingerprintLines(items: readonly CartLineInput[]): string {
  return items
    .map((i) => `${i.variantId}:${i.quantity}`)
    .sort()
    .join(',');
}

/**
 * Merge the guest cart into the server cart exactly once (server/CLAUDE.md "Cart": a NEW
 * idempotency key adds the quantities again, the same key replays).
 *
 * - concurrent calls share one request (single-flight);
 * - the key is generated once per distinct set of lines and kept until the merge succeeds, so a
 *   retry after a network failure replays instead of double-adding;
 * - on success the key is dropped — the caller then clears the guest cart.
 */
export function createCartMerger(deps: CartMergerDeps) {
  const newKey = deps.newKey ?? (() => newUlid());
  let inflight: Promise<CartMergeResult | null> | null = null;

  async function run(items: CartLineInput[]): Promise<CartMergeResult | null> {
    if (items.length === 0) {
      deps.keys.set(null);
      return null;
    }
    const fingerprint = fingerprintLines(items);
    const stored = deps.keys.get();
    const pending: PendingMerge =
      stored && stored.fingerprint === fingerprint ? stored : { key: newKey(), fingerprint };
    deps.keys.set(pending);
    const result = await deps.post(items, pending.key);
    deps.keys.set(null);
    return result;
  }

  return {
    merge(items: CartLineInput[]): Promise<CartMergeResult | null> {
      inflight ??= run(items).finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}

export interface AdjustmentSummary {
  clamped: number;
  unavailable: number;
}

/** Counts of what a merge changed, for the post-login toast. */
export function summarizeAdjustments(
  adjustments: readonly CartMergeAdjustment[],
): AdjustmentSummary {
  return {
    clamped: adjustments.filter((a) => a.reason === 'CLAMPED').length,
    unavailable: adjustments.filter((a) => a.reason === 'UNAVAILABLE').length,
  };
}
