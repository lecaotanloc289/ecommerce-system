import { describe, expect, it, vi } from 'vitest';
import { CartMergeResultSchema, type CartLineInput } from '@repo/core';
import {
  createCartMerger,
  fingerprintLines,
  summarizeAdjustments,
  type PendingMerge,
} from '../src/lib/cart-merge';

const ulid = (n: number) => `01JD${String(n).padStart(22, '0')}`;
const lines = (...pairs: [number, number][]): CartLineInput[] =>
  pairs.map(([id, quantity]) => ({
    variantId: ulid(id) as CartLineInput['variantId'],
    quantity,
  }));

const emptyResult = CartMergeResultSchema.parse({
  cart: { groups: [], itemCount: 0, hasMixedCurrency: false, currencies: [] },
  adjustments: [],
});

function memoryKeys() {
  let value: PendingMerge | null = null;
  return {
    get: () => value,
    set: (next: PendingMerge | null) => {
      value = next;
    },
  };
}

describe('cart merger', () => {
  it('does nothing for an empty guest cart', async () => {
    const post = vi.fn();
    const merger = createCartMerger({ post, keys: memoryKeys() });
    expect(await merger.merge([])).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('merges once: concurrent calls share one request with one key', async () => {
    const post = vi.fn().mockResolvedValue(emptyResult);
    const merger = createCartMerger({ post, keys: memoryKeys(), newKey: () => 'KEY-1' });
    const items = lines([1, 2], [2, 1]);
    const [a, b] = await Promise.all([merger.merge(items), merger.merge(items)]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(items, 'KEY-1');
    expect(a).toBe(b);
  });

  it('keeps the same key after a failure, so the retry replays instead of double-adding', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(emptyResult);
    let n = 0;
    const merger = createCartMerger({ post, keys: memoryKeys(), newKey: () => `KEY-${++n}` });
    const items = lines([1, 2]);
    await expect(merger.merge(items)).rejects.toThrow('network');
    await merger.merge(items);
    expect(post.mock.calls.map((c) => c[1])).toEqual(['KEY-1', 'KEY-1']);
  });

  it('uses a new key once the lines changed, and drops the key after success', async () => {
    const post = vi.fn().mockResolvedValue(emptyResult);
    const keys = memoryKeys();
    let n = 0;
    const merger = createCartMerger({ post, keys, newKey: () => `KEY-${++n}` });
    await merger.merge(lines([1, 2]));
    expect(keys.get()).toBeNull();
    await merger.merge(lines([1, 3]));
    expect(post.mock.calls.map((c) => c[1])).toEqual(['KEY-1', 'KEY-2']);
  });

  it('fingerprints lines regardless of order', () => {
    expect(fingerprintLines(lines([1, 2], [2, 1]))).toBe(fingerprintLines(lines([2, 1], [1, 2])));
    expect(fingerprintLines(lines([1, 2]))).not.toBe(fingerprintLines(lines([1, 3])));
  });
});

describe('summarizeAdjustments', () => {
  it('counts clamped and unavailable lines', () => {
    const summary = summarizeAdjustments([
      { variantId: ulid(1), reason: 'CLAMPED', requestedQuantity: 5, appliedQuantity: 3 },
      { variantId: ulid(2), reason: 'UNAVAILABLE', requestedQuantity: 1, appliedQuantity: 0 },
      { variantId: ulid(3), reason: 'UNAVAILABLE', requestedQuantity: 2, appliedQuantity: 0 },
    ] as never);
    expect(summary).toEqual({ clamped: 1, unavailable: 2 });
  });
});
