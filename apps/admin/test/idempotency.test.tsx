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

  it('gives different variables their own key, and keeps interleaved actions apart', () => {
    const tracker = createIdempotencyKeyTracker(sequentialKeys());
    expect(tracker.keyFor({ id: 'a' })).toBe('key-1');
    expect(tracker.keyFor({ id: 'b' })).toBe('key-2');
    expect(tracker.keyFor({ id: 'a' })).toBe('key-1'); // a's retry after b started
    tracker.succeeded({ id: 'b' });
    expect(tracker.keyFor({ id: 'a' })).toBe('key-1'); // b's success does not drop a's key
  });

  it('issues a new key after success, or after reset', () => {
    const tracker = createIdempotencyKeyTracker(sequentialKeys());
    tracker.keyFor('x');
    tracker.succeeded('x');
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
  /** `fail(vars, attempt)` decides the outcome of the n-th attempt for those variables. */
  function setup<TVars>(fail: (vars: TVars, attempt: number) => Error | null) {
    const calls: { vars: TVars; key: string }[] = [];
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () =>
        useApiMutation(
          (vars: TVars, headers) => {
            calls.push({ vars, key: headers['Idempotency-Key'] });
            const attempt = calls.filter((c) => c.vars === vars).length;
            const error = fail(vars, attempt);
            return error ? Promise.reject(error) : Promise.resolve('ok');
          },
          { retryDelay: 0 },
        ),
      { wrapper },
    );
    const keys = () => calls.map((c) => c.key);
    const keysFor = (vars: TVars) => calls.filter((c) => c.vars === vars).map((c) => c.key);
    return { keys, keysFor, hook };
  }

  it('automatic retries of a transient failure reuse the same key', async () => {
    const { keys, hook } = setup<string>((_v, n) =>
      n < 3 ? new ApiError(503, 'common.error.internal') : null,
    );

    await act(() => hook.result.current.mutateAsync('a'));

    expect(keys()).toHaveLength(3);
    expect(new Set(keys()).size).toBe(1);
  });

  it('does not retry a definitive 4xx', async () => {
    const { keys, hook } = setup<string>(() => new ApiError(422, 'common.error.validation-failed'));

    act(() => hook.result.current.mutate('a'));
    await waitFor(() => expect(hook.result.current.isError).toBe(true));

    expect(keys()).toHaveLength(1);
  });

  it('two actions in flight at once keep their own keys across retries', async () => {
    const { keysFor, hook } = setup<string>((v, n) =>
      v === 'a' && n === 1 ? new TypeError('offline') : null,
    );

    await act(() =>
      Promise.all([hook.result.current.mutateAsync('a'), hook.result.current.mutateAsync('b')]),
    );

    const [aFirst, aRetry] = keysFor('a');
    expect(aRetry).toBe(aFirst);
    expect(keysFor('b')).not.toContain(aFirst);
  });

  it('the user retrying after a failure reuses the key; the next action after success gets a new one', async () => {
    const { keys, hook } = setup<string>((_v, n) =>
      n === 1 ? new ApiError(409, 'common.error.conflict') : null,
    );

    await act(() => hook.result.current.mutateAsync('a').catch(() => undefined));
    await act(() => hook.result.current.mutateAsync('a')); // "Try again" button
    await act(() => hook.result.current.mutateAsync('a')); // a new action with the same input

    expect(keys()[1]).toBe(keys()[0]);
    expect(keys()[2]).not.toBe(keys()[1]);
  });

  it('resetAction forces a fresh key', async () => {
    const { keys, hook } = setup<string>((_v, n) =>
      n === 1 ? new ApiError(409, 'common.error.conflict') : null,
    );

    await act(() => hook.result.current.mutateAsync('a').catch(() => undefined));
    act(() => hook.result.current.resetAction());
    await act(() => hook.result.current.mutateAsync('a'));

    expect(keys()[1]).not.toBe(keys()[0]);
  });
});
