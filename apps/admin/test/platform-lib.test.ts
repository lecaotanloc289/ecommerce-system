import { describe, expect, it } from 'vitest';
import { ApiError, errorMessage } from '@/lib/api-error';
import { bpsToPercent, percentToBps } from '@/lib/bps';
import { compact } from '@/lib/compact';
import { validateSettingsForm, type SettingsFormValues } from '@/lib/settings-form';
import { suggestSlug } from '@/lib/slug';

describe('bps <-> percent', () => {
  it.each([
    [0, '0'],
    [5, '0.05'],
    [10, '0.1'],
    [250, '2.5'],
    [1000, '10'],
    [1234, '12.34'],
    [10_000, '100'],
  ])('%i bps is %s %%', (bps, percent) => {
    expect(bpsToPercent(bps)).toBe(percent);
    expect(percentToBps(percent)).toBe(bps);
  });

  it('accepts a decimal comma and surrounding spaces', () => {
    expect(percentToBps(' 2,5 ')).toBe(250);
  });

  it('is exact on integers for every basis point (no float drift)', () => {
    for (let bps = 0; bps <= 10_000; bps++) {
      expect(percentToBps(bpsToPercent(bps))).toBe(bps);
    }
  });

  it.each(['', 'abc', '-1', '100.01', '101', '1.234', '1e2', '.5', '5.'])('rejects %j', (text) => {
    expect(percentToBps(text)).toBeNull();
  });

  it('refuses out-of-range or non-integer bps', () => {
    expect(() => bpsToPercent(-1)).toThrow(RangeError);
    expect(() => bpsToPercent(10_001)).toThrow(RangeError);
    expect(() => bpsToPercent(1.5)).toThrow(RangeError);
  });
});

describe('suggestSlug', () => {
  it('transliterates Vietnamese and hyphenates', () => {
    expect(suggestSlug('Cửa Hàng Đẹp Lắm!')).toBe('cua-hang-dep-lam');
    expect(suggestSlug('  Nguyễn  Văn An ')).toBe('nguyen-van-an');
  });
  it('returns an empty string when nothing usable remains', () => {
    expect(suggestSlug('!!!')).toBe('');
  });
});

describe('compact', () => {
  it('drops undefined values and keeps the rest', () => {
    expect(compact({ a: 1, b: undefined, c: 'x', d: 0 })).toEqual({ a: 1, c: 'x', d: 0 });
  });
});

const valid: SettingsFormValues = {
  commission: '2.5',
  holdPeriodDays: '7',
  refundWindowDays: '14',
  paymentTimeoutMinutes: '30',
  maxCouponStack: '2',
  supportedCurrencies: ['VND', 'USD'],
  defaultCurrency: 'VND',
};

describe('validateSettingsForm', () => {
  it('builds the PATCH body with commission as basis points', () => {
    expect(validateSettingsForm(valid)).toEqual({
      ok: true,
      update: {
        commissionBps: 250,
        holdPeriodDays: 7,
        refundWindowDays: 14,
        paymentTimeoutMinutes: 30,
        maxCouponStack: 2,
        supportedCurrencies: ['VND', 'USD'],
        defaultCurrency: 'VND',
      },
    });
  });

  it('accepts the bounds and rejects one step outside them', () => {
    const at = (patch: Partial<SettingsFormValues>) => validateSettingsForm({ ...valid, ...patch });
    expect(
      at({
        commission: '100',
        holdPeriodDays: '365',
        paymentTimeoutMinutes: '1440',
        maxCouponStack: '10',
      }).ok,
    ).toBe(true);
    expect(
      at({
        commission: '0',
        holdPeriodDays: '0',
        refundWindowDays: '0',
        paymentTimeoutMinutes: '5',
        maxCouponStack: '1',
      }).ok,
    ).toBe(true);

    const bad = (patch: Partial<SettingsFormValues>) => {
      const result = at(patch);
      return result.ok ? null : result.errors;
    };
    expect(bad({ commission: '100.01' })?.commission).toEqual({ kind: 'percentInvalid' });
    expect(bad({ holdPeriodDays: '366' })?.holdPeriodDays).toEqual({
      kind: 'range',
      min: 0,
      max: 365,
    });
    expect(bad({ refundWindowDays: '-1' })?.refundWindowDays).toMatchObject({ kind: 'range' });
    expect(bad({ paymentTimeoutMinutes: '4' })?.paymentTimeoutMinutes).toEqual({
      kind: 'range',
      min: 5,
      max: 1440,
    });
    expect(bad({ paymentTimeoutMinutes: '1441' })?.paymentTimeoutMinutes).toMatchObject({
      kind: 'range',
    });
    expect(bad({ maxCouponStack: '0' })?.maxCouponStack).toEqual({
      kind: 'range',
      min: 1,
      max: 10,
    });
    expect(bad({ maxCouponStack: '11' })?.maxCouponStack).toMatchObject({ kind: 'range' });
    expect(bad({ maxCouponStack: '1.5' })?.maxCouponStack).toMatchObject({ kind: 'range' });
    expect(bad({ maxCouponStack: '' })?.maxCouponStack).toMatchObject({ kind: 'range' });
  });

  it('requires the default currency to be one of the supported ones', () => {
    const result = validateSettingsForm({
      ...valid,
      supportedCurrencies: ['USD'],
      defaultCurrency: 'VND',
    });
    expect(result).toEqual({
      ok: false,
      errors: { defaultCurrency: { kind: 'defaultNotSupported' } },
    });
  });

  it('requires at least one currency', () => {
    const result = validateSettingsForm({ ...valid, supportedCurrencies: [] });
    expect(result).toEqual({
      ok: false,
      errors: { supportedCurrencies: { kind: 'currenciesRequired' } },
    });
  });
});

describe('errorMessage with params.reason', () => {
  it.each(['last-platform-admin', 'self-demotion', 'not-platform-admin'])(
    'replaces the generic text for %s (en + vi differ)',
    (reason) => {
      const error = new ApiError(409, 'common.error.conflict', { reason });
      const generic = errorMessage('en', new ApiError(409, 'common.error.conflict'));
      expect(errorMessage('en', error)).not.toBe(generic);
      expect(errorMessage('vi', error)).not.toBe(errorMessage('en', error));
    },
  );

  it('appends the not-refundable reason to the base message', () => {
    const base = errorMessage('en', new ApiError(409, 'refund.error.not-refundable'));
    const message = errorMessage(
      'en',
      new ApiError(409, 'refund.error.not-refundable', { reason: 'payout-released' }),
    );
    expect(message.startsWith(base)).toBe(true);
    expect(message).toContain('payout was already released');
  });

  it('explains a retry of a refund that did not fail', () => {
    expect(
      errorMessage(
        'en',
        new ApiError(409, 'refund.error.not-refundable', { reason: 'refund-not-failed' }),
      ),
    ).toContain('Only a refund the provider refused');
  });

  it('names the shop currency for a price in another currency (vendor portal)', () => {
    const error = new ApiError(422, 'common.error.validation-failed', {
      field: 'currency',
      currency: 'USD',
      expected: 'VND',
    });
    expect(errorMessage('en', error)).toBe('This shop sells in VND only. Use VND for every price.');
    expect(errorMessage('vi', error)).toContain('VND');
    // Any other validation failure keeps the generic text.
    expect(
      errorMessage('en', new ApiError(422, 'common.error.validation-failed', { field: 'name' })),
    ).toBe(errorMessage('en', new ApiError(422, 'common.error.validation-failed')));
  });

  it('keeps the base message for an unknown reason', () => {
    const base = errorMessage('en', new ApiError(409, 'common.error.conflict'));
    expect(
      errorMessage('en', new ApiError(409, 'common.error.conflict', { reason: 'other' })),
    ).toBe(base);
  });
});
