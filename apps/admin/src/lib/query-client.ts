import { QueryClient } from '@tanstack/react-query';
import { retryTransient } from './api-error';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: retryTransient, // a 403/404/422 will not change on retry
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false, // use `useApiMutation`, which retries with the same Idempotency-Key
      },
    },
  });
}
