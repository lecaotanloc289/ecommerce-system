import { useState } from 'react';
import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';
import { retryTransient } from './api-error';
import { createIdempotencyKeyTracker } from './idempotency';

export type ApiMutationOptions<TData, TVariables> = Omit<
  UseMutationOptions<TData, Error, TVariables>,
  'mutationFn'
>;

export type ApiMutationResult<TData, TVariables> = UseMutationResult<TData, Error, TVariables> & {
  /** Start over: the next `mutate` gets a fresh `Idempotency-Key` even with the same variables. */
  resetAction: () => void;
};

/** Pass straight through as the request's `headers` (the SDK keeps a caller-supplied key). */
export interface IdempotencyHeaders {
  'Idempotency-Key': string;
}

/**
 * `useMutation` for API writes that always sends an `Idempotency-Key` and reuses it for every
 * attempt at the same user action (see `createIdempotencyKeyTracker`):
 *
 * ```ts
 * const approve = useApiMutation((id: string, headers) =>
 *   unwrap(api.POST('/v1/platform/vendor-applications/{id}/approve', {
 *     params: { path: { id } },
 *     headers,
 *   })),
 * );
 * approve.mutate(applicationId);
 * ```
 *
 * Always forward `headers` — otherwise `@repo/sdk` generates a new key per request and a retry
 * would execute the action twice. Transient failures (network, 5xx, 429, in-progress) are retried
 * up to twice with the same key; override with `options.retry`.
 */
export function useApiMutation<TData, TVariables = void>(
  mutationFn: (variables: TVariables, headers: IdempotencyHeaders) => Promise<TData>,
  options: ApiMutationOptions<TData, TVariables> = {},
): ApiMutationResult<TData, TVariables> {
  const [tracker] = useState(createIdempotencyKeyTracker);
  const mutation = useMutation<TData, Error, TVariables>({
    retry: retryTransient,
    ...options,
    mutationFn: (variables) =>
      mutationFn(variables, { 'Idempotency-Key': tracker.keyFor(variables) }),
    onSuccess: (data, variables, ...rest) => {
      tracker.succeeded(variables);
      return options.onSuccess?.(data, variables, ...rest);
    },
  });
  return { ...mutation, resetAction: tracker.reset };
}
