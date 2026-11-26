import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  IdempotencyKeySchema,
  OrderIdSchema,
  UlidSchema,
  UserIdSchema,
  type Brand,
  type OrderId,
  type UserId,
} from '../src/ids';

const VALID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('UlidSchema', () => {
  it('accepts a canonical ULID', () => {
    expect(UlidSchema.parse(VALID)).toBe(VALID);
    expect(UlidSchema.safeParse('7ZZZZZZZZZZZZZZZZZZZZZZZZZ').success).toBe(true);
  });

  it.each([
    ['lowercase', VALID.toLowerCase()],
    ['too short', VALID.slice(1)],
    ['too long', `${VALID}0`],
    ['contains I', '01ARZ3NDEKTSV4RRFFQ69G5FAI'],
    ['contains L', '01ARZ3NDEKTSV4RRFFQ69G5FAL'],
    ['contains O', '01ARZ3NDEKTSV4RRFFQ69G5FAO'],
    ['contains U', '01ARZ3NDEKTSV4RRFFQ69G5FAU'],
    ['timestamp overflow (first char > 7)', '81ARZ3NDEKTSV4RRFFQ69G5FAV'],
    ['seed-style text id', 'vendor_a'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(UlidSchema.safeParse(value).success).toBe(false);
  });
});

describe('branded ids', () => {
  it('parse to the same runtime string', () => {
    expect(UserIdSchema.parse(VALID)).toBe(VALID);
    expect(IdempotencyKeySchema.safeParse('not-a-ulid').success).toBe(false);
  });

  it('are nominal: one id type is not another, nor a plain string', () => {
    expectTypeOf(UserIdSchema.parse(VALID)).toEqualTypeOf<UserId>();
    expectTypeOf(OrderIdSchema.parse(VALID)).toEqualTypeOf<OrderId>();
    expectTypeOf<UserId>().toEqualTypeOf<Brand<string, 'UserId'>>();
    expectTypeOf<UserId>().not.toEqualTypeOf<OrderId>();
    expectTypeOf<string>().not.toExtend<UserId>();
    expectTypeOf<UserId>().toExtend<string>();
  });
});
