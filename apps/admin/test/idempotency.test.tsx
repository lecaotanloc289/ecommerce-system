import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-error';
import { createIdempotencyKeyTracker, stableStringify } from '@/lib/idempotency';
import { useApiMutation } from '@/lib/use-api-mutation';

function sequentialKeys() {
  let n = 0;
  return () => `key-${++n}`;
}

describe('createIdempotencyKeyTracker', () => {
  it('reuses the key for every attempt at the same action', () => {
    const tracker = createIdempotencyKeyTracker(sequentialKeys());
    expect(tracker.keyFor({ id: 'a' })).toBe('key-1');
    expect(tracker.keyFor({ id: 'a' })).toBe('key-1');
  });

  it('treats objects with the same content in a different key order as the same action', () => {
    const tracker = createIdempotencyKeyTracker(sequentialKeys());
    expect(tracker.keyFor({ a: 1, b: { c: 2, d: 3 } })).toBe('key-1');
    expect(tracker.keyFor({ b: { d: 3, c: 2 }, a: 1 })).toBe('key-1');
  });

  it('issues a new key when the variables change', () => {
    const tracker = createIdempotencyKeyTracker(sequentialKeys());
    expect(tracker.keyFor({ id: 'a' })).toBe('key-1');
    expect(tracker.keyFor({ id: 'b' })).toBe('key-2');
  });

  it('issues a new key after success, or after reset', () => {
    const tracker = createIdempotencyKeyTracker(sequentialKeys());
    tracker.keyFor('x');
    tracker.succeeded();
    expect(tracker.keyFor('x')).toBe('key-2');
    tracker.reset();
    expect(tracker.keyFor('x')).toBe('key-3');
  });

  it('defaults to ULID keys', () => {
    expect(createIdempotencyKeyTracker().keyFor(undefined)).toMatch(
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/,
    );
  });

  it('stableStringify is order-insensitive for objects but not for arrays', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe('useApiMutation', () => {
  function setup<TVars>(fail: (attempt: number) => Error | null) {
    const keys: string[] = [];
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () =>
        useApiMutation(
          (_vars: TVars, key: string) => {
            keys.push(key);
            const error = fail(keys.length);
            return error ? Promise.reject(error) : Promise.resolve('ok');
          },
          { retryDelay: 0 },
        ),
      { wrapper },
    );
    return { keys, hook };
  }

  it('automatic retries of a transient failure reuse the same key', async () => {
    const { keys, hook } = setup<{ id: string }>((n) =>
      n < 3 ? new ApiError(503, 'common.error.internal') : null,
    );

    await act(() => hook.result.current.mutateAsync({ id: 'a' }));

    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
  });

  it('does not retry a definitive 4xx', async () => {
    const { keys, hook } = setup<string>(() => new ApiError(422, 'common.error.validation-failed'));

    act(() => hook.result.current.mutate('a'));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));

    expect(keys).toHaveLength(1);
  });

  it('the user retrying after a failure reuses the key; the next action after success gets a new one', async () => {
    const { keys, hook } = setup<string>((n) =>
      n === 1 ? new ApiError(409, 'common.error.conflict') : null,
    );

    await act(() => hook.result.current.mutateAsync('a').catch(() => undefined));
    await act(() => hook.result.current.mutateAsync('a')); // "Try again" button
    await act(() => hook.result.current.mutateAsync('a')); // a new action with the same input

    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('resetAction forces a fresh key', async () => {
    const { keys, hook } = setup<string>((n) =>
      n === 1 ? new ApiError(409, 'common.error.conflict') : null,
    );

    await act(() => hook.result.current.mutateAsync('a').catch(() => undefined));
    act(() => hook.result.current.resetAction());
    await act(() => hook.result.current.mutateAsync('a'));

    expect(keys[1]).not.toBe(keys[0]);
  });
});
