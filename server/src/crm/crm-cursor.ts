import { DomainError, IsoDateTimeSchema, UserIdSchema } from '@repo/core';
import { z } from 'zod';
import type { CrmCustomerKey, CrmCustomerSort } from './crm-customers.repository';

/**
 * Opaque keyset cursor of `GET /v1/vendor/crm/customers`: base64url(JSON) of the last row's sort
 * key + customer id. `s` pins the sort it was issued for, so a cursor replayed with another `sort`
 * is rejected instead of silently skipping rows.
 */
const PG_INT_MAX = 2_147_483_647;
/** Real instants only, inside the range Postgres `timestamp` accepts (no year 0, no NaN). */
const MIN_CURSOR_MS = Date.UTC(1970, 0, 1);
const MAX_CURSOR_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
const CursorInstantSchema = IsoDateTimeSchema.refine((iso) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms >= MIN_CURSOR_MS && ms <= MAX_CURSOR_MS;
});

const CursorSchema = z.discriminatedUnion('s', [
  z.object({ s: z.literal('last_order'), k: CursorInstantSchema, id: UserIdSchema }).strict(),
  z
    .object({
      s: z.literal('order_count'),
      k: z.number().int().nonnegative().max(PG_INT_MAX),
      id: UserIdSchema,
    })
    .strict(),
]);

export function encodeCustomerCursor(key: CrmCustomerKey): string {
  const payload =
    key.sort === 'last_order'
      ? { s: key.sort, k: key.lastOrderAt.toISOString(), id: key.customerId }
      : { s: key.sort, k: key.orderCount, id: key.customerId };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Garbage, tampered or other-sort cursors → 422 `common.error.validation-failed {field: 'cursor'}`. */
export function decodeCustomerCursor(cursor: string, sort: CrmCustomerSort): CrmCustomerKey {
  const invalid = () => new DomainError('common.error.validation-failed', { field: 'cursor' });
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const parsed = CursorSchema.safeParse(json);
  if (!parsed.success || parsed.data.s !== sort) throw invalid();
  const c = parsed.data;
  return c.s === 'last_order'
    ? { sort: 'last_order', lastOrderAt: new Date(c.k), customerId: c.id }
    : { sort: 'order_count', orderCount: c.k, customerId: c.id };
}
