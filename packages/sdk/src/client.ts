import createClient, { type Client } from 'openapi-fetch';
import { ulid } from 'ulid';
import type { paths } from './schema';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
const REFRESH_PATH = '/v1/auth/refresh';
const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH']);

export interface ApiClientOptions {
  /** API origin, WITHOUT the `/v1` prefix (paths in the generated schema already include it). */
  baseUrl: string;
  /** Current in-memory access token. Never persist it to localStorage/sessionStorage. */
  getAccessToken: () => string | null | undefined | Promise<string | null | undefined>;
  /** Called with every access token obtained by an automatic refresh — store it in memory. */
  onAccessToken?: (accessToken: string) => void;
  /** Called when a refresh is rejected (session over): redirect to login / clear state. */
  onUnauthorized?: () => void;
  /** Custom fetch (tests, or to forward cookies server-side). Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

export type ApiClient = Client<paths>;

/**
 * Typed API client (openapi-fetch) with:
 * - `Authorization: Bearer <token>` from `getAccessToken` (unless the caller set one);
 * - `credentials: 'include'` so the HttpOnly refresh cookie is sent;
 * - an auto-generated ULID `Idempotency-Key` on POST/PUT/PATCH when the caller passed none;
 * - on 401, ONE single-flight `POST /v1/auth/refresh` shared by all concurrent callers, then
 *   a single retry of the original request (same Idempotency-Key) with the new token.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const baseFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));

  let inflightRefresh: Promise<string | null> | null = null;

  async function requestRefresh(): Promise<string | null> {
    let response: Response;
    try {
      response = await baseFetch(`${baseUrl}${REFRESH_PATH}`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch {
      return null; // network failure is not proof the session is over
    }
    if (!response.ok) {
      // Only a definitive rejection ends the session; 408/429/5xx are transient.
      if (response.status === 401 || response.status === 403) options.onUnauthorized?.();
      return null;
    }
    const body: unknown = await response.json().catch(() => null);
    const token = readAccessToken(body);
    if (token === null) return null;
    options.onAccessToken?.(token);
    return token;
  }

  /** Single-flight: concurrent 401s await the same refresh (the server rotates the cookie). */
  function refresh(): Promise<string | null> {
    inflightRefresh ??= requestRefresh().finally(() => {
      inflightRefresh = null;
    });
    return inflightRefresh;
  }

  async function fetchWithRefresh(request: Request): Promise<Response> {
    const retry = request.clone(); // body must be cloned before the first send consumes it
    const response = await baseFetch(request);
    if (response.status !== 401 || new URL(request.url).pathname === REFRESH_PATH) {
      return response;
    }
    const token = await refresh();
    if (token === null) return response;
    await response.body?.cancel();
    retry.headers.set('Authorization', `Bearer ${token}`);
    return baseFetch(retry);
  }

  const client = createClient<paths>({
    baseUrl,
    credentials: 'include',
    fetch: fetchWithRefresh,
  });

  client.use({
    async onRequest({ request }) {
      if (!request.headers.has('Authorization')) {
        const token = await options.getAccessToken();
        if (token) request.headers.set('Authorization', `Bearer ${token}`);
      }
      if (IDEMPOTENT_METHODS.has(request.method) && !request.headers.has(IDEMPOTENCY_HEADER)) {
        request.headers.set(IDEMPOTENCY_HEADER, ulid());
      }
      return request;
    },
  });

  return client;
}

function readAccessToken(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('accessToken' in body)) return null;
  const { accessToken } = body;
  return typeof accessToken === 'string' && accessToken.length > 0 ? accessToken : null;
}
