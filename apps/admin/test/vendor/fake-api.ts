import { vi } from 'vitest';
import { json } from '../fixtures';

export type Handler = (request: Request) => Response | Promise<Response>;

export const TOKEN = { accessToken: 'access-2', tokenType: 'Bearer', expiresIn: 900 };

/**
 * Replaces the global `fetch` (the app's `api` singleton calls it at request time) with a fake
 * routed by `METHOD /path`. Unknown routes answer 404 instead of throwing, so pages that fetch
 * extra data (dashboard counts, wallet) do not break unrelated tests.
 */
export function stubApi(routes: Record<string, Handler>) {
  const calls: Request[] = [];
  const fake = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request);
    const handler = routes[`${request.method} ${new URL(request.url).pathname}`];
    return Promise.resolve(
      handler ? handler(request) : json({ errorCode: 'common.error.not-found', params: {} }, 404),
    );
  });
  vi.stubGlobal('fetch', fake);
  const find = (route: string) =>
    calls.filter((request) => `${request.method} ${new URL(request.url).pathname}` === route);
  return { calls, find };
}

export const EMPTY_PAGE = { items: [], nextCursor: null };
