import { beforeEach, describe, expect, it } from 'vitest';
import { isSafeReturnPath, readReturnPath, saveReturnPath } from '@/auth/return-path';
import { normalizeApiUrl } from '@/env';
import { ApiError, errorMessage, isTransientError, toApiError, unwrap } from '@/lib/api-error';
import { json } from './fixtures';

describe('errorMessage', () => {
  it('translates an API errorCode with its params', () => {
    const error = toApiError(409, { errorCode: 'vendor.error.not-active', params: {} });
    expect(errorMessage('en', error)).not.toBe('vendor.error.not-active');
    expect(errorMessage('vi', error)).not.toBe(errorMessage('en', error));
  });

  it('falls back to the generic message for an unknown code or body', () => {
    const generic = errorMessage('en', new ApiError(500, 'common.error.internal'));
    expect(errorMessage('en', toApiError(500, { errorCode: 'brand.new-code' }))).toBe(generic);
    expect(errorMessage('en', toApiError(502, '<html>bad gateway</html>'))).toBe(generic);
    expect(errorMessage('en', new Error('boom'))).toBe(generic);
  });

  it('maps a fetch rejection to the network message', () => {
    expect(errorMessage('en', new TypeError('Failed to fetch'))).toContain(
      'Cannot reach the server',
    );
  });
});

describe('unwrap', () => {
  it('returns data or throws an ApiError with the server code', async () => {
    await expect(unwrap(Promise.resolve({ data: 1, response: json(1) }))).resolves.toBe(1);
    const failed = unwrap(
      Promise.resolve({
        error: { errorCode: 'common.error.forbidden', params: {} },
        response: json({}, 403),
      }),
    );
    await expect(failed).rejects.toMatchObject({
      status: 403,
      errorCode: 'common.error.forbidden',
    });
  });
});

describe('isTransientError', () => {
  it.each([
    [new TypeError('offline'), true],
    [new ApiError(503, 'common.error.internal'), true],
    [new ApiError(429, 'common.error.rate-limited'), true],
    [new ApiError(409, 'idempotency.error.in-progress'), true],
    [new ApiError(409, 'common.error.conflict'), false],
    [new ApiError(422, 'common.error.validation-failed'), false],
  ])('%s → %s', (error, expected) => {
    expect(isTransientError(error)).toBe(expected);
  });
});

describe('normalizeApiUrl', () => {
  it.each([
    [undefined, 'http://localhost:3001'],
    ['', 'http://localhost:3001'],
    ['https://api.example.com', 'https://api.example.com'],
    ['https://api.example.com/', 'https://api.example.com'],
    ['http://localhost:3001/v1', 'http://localhost:3001'],
    ['http://localhost:3001/v1/', 'http://localhost:3001'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeApiUrl(raw)).toBe(expected);
  });
});

describe('return path after OAuth', () => {
  beforeEach(() => sessionStorage.clear());

  it.each([
    ['/platform/settings?tab=fees', true],
    ['/', true],
    ['//evil.example', false],
    ['/\\evil.example', false],
    ['/\t/evil.example', false],
    ['/\n/evil.example', false],
    ['/vendor\\..\\x', false],
    ['https://evil.example', false],
    ['/login', false],
    ['/auth/callback?error=x', false],
  ])('isSafeReturnPath(%s) → %s', (path, expected) => {
    expect(isSafeReturnPath(path)).toBe(expected);
  });

  it('round-trips a deep link and replaces unsafe ones with /', () => {
    expect(readReturnPath()).toBe('/');
    saveReturnPath('/vendor/orders');
    expect(readReturnPath()).toBe('/vendor/orders');
    saveReturnPath('//evil.example');
    expect(readReturnPath()).toBe('/');
  });
});
