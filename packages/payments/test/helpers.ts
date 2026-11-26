import { DomainError } from '@repo/core';

/** Error code a sync call throws: the DomainError code, `not-domain-error`, or `no-throw`. */
export function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'not-domain-error';
  }
  return 'no-throw';
}

/** Same as `codeOf` for a promise. */
export async function asyncCodeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof DomainError ? error.code : 'not-domain-error';
  }
  return 'no-throw';
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
