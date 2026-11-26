import { describe, expect, it } from 'vitest';
import { formatMoneyInput, moneyFromInput, parseMoneyInput } from '@/lib/money-input';

describe('parseMoneyInput', () => {
  it.each([
    ['150000', 150000],
    ['150.000', 150000],
    ['150,000', 150000],
    ['1.234.567', 1234567],
    ['0', 0],
  ])('VND %s → %d đồng', (text, expected) => {
    expect(parseMoneyInput(text, 'VND')).toBe(expected);
  });

  it.each(['1.5', '1,5', '12.34', '-5', 'abc', '', '  ', '1.2.3', '1 000,5'])(
    'VND rejects %j',
    (text) => {
      expect(parseMoneyInput(text, 'VND')).toBeNull();
    },
  );

  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['12,5', 1250],
    ['19.99', 1999], // float math gives 1998.9999999999998
    ['0.1', 10],
    ['0.07', 7],
    ['.5', 50],
    ['1,234', 123400],
    ['1,234.50', 123450],
    ['  8.00 ', 800],
  ])('USD %s → %d cents', (text, expected) => {
    expect(parseMoneyInput(text, 'USD')).toBe(expected);
  });

  it.each(['12.345', '1.234', '1,2345', '-1', '1e3', '$5', '12.', 'x.5'])(
    'USD rejects %j',
    (text) => {
      expect(parseMoneyInput(text, 'USD')).toBeNull();
    },
  );

  it('rejects amounts beyond the safe integer range instead of rounding', () => {
    expect(parseMoneyInput('9007199254740993', 'VND')).toBeNull();
    expect(parseMoneyInput('9007199254740991', 'VND')).toBe(9007199254740991);
  });
});

describe('formatMoneyInput / moneyFromInput', () => {
  it('formats minor units as editable text and round-trips', () => {
    expect(formatMoneyInput(150000, 'VND')).toBe('150000');
    expect(formatMoneyInput(1999, 'USD')).toBe('19.99');
    expect(formatMoneyInput(5, 'USD')).toBe('0.05');
    expect(formatMoneyInput(1200, 'USD')).toBe('12.00');
    for (const [amount, currency] of [
      [1999, 'USD'],
      [7, 'USD'],
      [250000, 'VND'],
    ] as const) {
      expect(parseMoneyInput(formatMoneyInput(amount, currency), currency)).toBe(amount);
    }
  });

  it('returns empty text for an invalid amount', () => {
    expect(formatMoneyInput(-1, 'VND')).toBe('');
    expect(formatMoneyInput(1.5, 'VND')).toBe('');
  });

  it('builds a Money value or null', () => {
    expect(moneyFromInput('19.99', 'USD')).toEqual({ amount: 1999, currency: 'USD' });
    expect(moneyFromInput('x', 'USD')).toBeNull();
  });
});
