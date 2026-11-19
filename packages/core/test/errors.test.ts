import { describe, expect, it } from 'vitest';
import {
  DomainError,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ErrorCodeSchema,
  ErrorResponseSchema,
  isDomainError,
} from '../src/errors';

describe('error catalog', () => {
  it('codes are unique', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it.each(ERROR_CODES)('%s follows <domain>.error.<kebab> and maps to a 4xx/5xx', (code) => {
    expect(code).toMatch(/^[a-z]+(?:-[a-z]+)*\.error\.[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const status = ERROR_HTTP_STATUS[code];
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
  });

  it('has no status entries for unknown codes', () => {
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('ErrorCodeSchema rejects unknown codes', () => {
    expect(ErrorCodeSchema.safeParse('checkout.error.out-of-stock').success).toBe(true);
    expect(ErrorCodeSchema.safeParse('checkout.error.nope').success).toBe(false);
  });
});

describe('ErrorResponseSchema', () => {
  it('accepts errorCode + scalar params', () => {
    const body = {
      errorCode: 'checkout.error.out-of-stock',
      params: { sku: 'TS-M', available: 2 },
    };
    expect(ErrorResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects nested params and missing params', () => {
    expect(
      ErrorResponseSchema.safeParse({ errorCode: 'common.error.internal', params: { a: { b: 1 } } })
        .success,
    ).toBe(false);
    expect(ErrorResponseSchema.safeParse({ errorCode: 'common.error.internal' }).success).toBe(
      false,
    );
  });
});

describe('DomainError', () => {
  it('carries code, params and status, and serialises to an ErrorResponse', () => {
    const error = new DomainError('checkout.error.out-of-stock', { sku: 'TS-M', available: 0 });
    expect(error).toBeInstanceOf(Error);
    expect(isDomainError(error)).toBe(true);
    expect(isDomainError(new Error('x'))).toBe(false);
    expect(error.httpStatus).toBe(409);
    expect(ErrorResponseSchema.parse(error.toResponse())).toEqual({
      errorCode: 'checkout.error.out-of-stock',
      params: { sku: 'TS-M', available: 0 },
    });
  });

  it('defaults params to {}', () => {
    expect(new DomainError('common.error.forbidden').params).toEqual({});
  });
});
