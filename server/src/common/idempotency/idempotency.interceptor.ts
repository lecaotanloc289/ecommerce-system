import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { DomainError, IdempotencyKeySchema } from '@repo/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { type Observable, catchError, defaultIfEmpty, from, mergeMap, of, throwError } from 'rxjs';
import { fingerprintRequest } from './fingerprint';
import { IdempotencyStore } from './idempotency.store';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';

/**
 * Golden Rule #3 / D9 — applied per handler by `@Idempotent()`; runs after the guards, so
 * `request.user` is set. Key = `idem:{userId}:{Idempotency-Key}`; fingerprint = sha256 of
 * method + URL + canonical JSON body.
 *
 * - missing / non-ULID header → 400 `idempotency.error.key-required`
 * - no authenticated user → 401 `common.error.unauthorized` (fails closed; keys are user-scoped)
 * - same key, different fingerprint → 422 `idempotency.error.key-reused`
 * - same key still running → 409 `idempotency.error.in-progress`
 * - same key completed → the stored status + body, header `idempotent-replayed: true`
 *
 * Only 2xx responses are stored (24h) — status + body only, so handlers must not rely on response
 * headers. Any error releases the key so the client may retry with the same key — a failed attempt
 * must not pin its error for a day. If storing the response fails, or the 60s lock expired first,
 * the response is still returned (logged). Money-moving writes (checkout, payments) therefore ALSO
 * need a DB unique constraint on the idempotency key; Redis alone is not a guarantee.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly store: IdempotencyStore) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const idemKey = IdempotencyKeySchema.safeParse(request.headers[IDEMPOTENCY_KEY_HEADER]);
    if (!idemKey.success) throw new DomainError('idempotency.error.key-required');
    if (!request.user) throw new DomainError('common.error.unauthorized');

    const key = `idem:${request.user.id}:${idemKey.data}`;
    const fingerprint = fingerprintRequest(request.method, request.url, request.body);
    const result = await this.store.acquire(key, fingerprint);

    switch (result.outcome) {
      case 'key-reused':
        throw new DomainError('idempotency.error.key-reused');
      case 'in-progress':
        throw new DomainError('idempotency.error.in-progress');
      case 'replay':
        void reply.status(result.status).header(IDEMPOTENT_REPLAYED_HEADER, 'true');
        return of(result.body);
      case 'acquired':
        return next.handle().pipe(
          // A stream that completes without a value must still settle the lock.
          defaultIfEmpty(undefined),
          mergeMap(async (body: unknown) => {
            await this.finish(key, result.lock, fingerprint, reply.statusCode, body);
            return body;
          }),
          catchError((error: unknown) =>
            from(this.release(key, result.lock)).pipe(mergeMap(() => throwError(() => error))),
          ),
        );
    }
  }

  private async finish(
    key: string,
    lock: string,
    fingerprint: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    if (status < 200 || status >= 300) return this.release(key, lock);
    try {
      const stored = await this.store.complete(key, lock, fingerprint, status, body);
      if (!stored) {
        // The handler outlived IDEMPOTENCY_LOCK_TTL_MS; a retry may have executed it again.
        this.logger.warn({ key }, 'idempotency lock expired before the response was stored');
      }
    } catch (error) {
      this.logger.error({ err: error, key }, 'failed to store idempotent response');
    }
  }

  private async release(key: string, lock: string): Promise<void> {
    try {
      await this.store.release(key, lock);
    } catch (error) {
      // The lock expires on its own after IDEMPOTENCY_LOCK_TTL_MS.
      this.logger.error({ err: error, key }, 'failed to release idempotency lock');
    }
  }
}
