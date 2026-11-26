/** Query parameters whose values are credentials and must never reach the request log. */
const SECRET_QUERY_PARAMS = ['token'];

/**
 * Replaces the values of secret query parameters (`?token=…`, e.g. the RFC 8058 one-click
 * unsubscribe link `POST /v1/crm/unsubscribe/one-click?token=…` — a permanent per-(customer, shop)
 * credential) with `[redacted]`. Anything that does not parse is returned unchanged.
 */
export function redactUrlSecrets(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  let changed = false;
  for (const name of SECRET_QUERY_PARAMS) {
    if (params.has(name)) {
      params.set(name, '[redacted]');
      changed = true;
    }
  }
  return changed ? `${url.slice(0, q)}?${params.toString()}` : url;
}

/** pino-http `serializers.req`: the standard serialized request with secret query values redacted. */
export function redactRequestUrl<T extends { url?: unknown }>(req: T): T {
  if (typeof req.url === 'string') req.url = redactUrlSecrets(req.url);
  return req;
}
