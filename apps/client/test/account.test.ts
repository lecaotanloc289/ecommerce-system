import { describe, expect, it } from 'vitest';
import { AddressSchema, UlidSchema, type Address } from '@repo/core';
import {
  EMPTY_ADDRESS_FORM,
  addressToFormValues,
  sortAddresses,
  validateAddressEdit,
  validateNewAddress,
  withDefault,
  withoutAddress,
} from '../src/lib/addresses';
import { newIdempotencyKey } from '../src/lib/idempotency';

const id = (n: number) => `01JD${String(n).padStart(22, '0')}`;

function address(n: number, overrides: Partial<Address> = {}): Address {
  return AddressSchema.parse({
    id: id(n),
    recipientName: `Recipient ${n}`,
    phone: '0901234567',
    line1: '1 Le Loi',
    line2: null,
    ward: 'Ben Nghe',
    district: 'District 1',
    city: 'Ho Chi Minh',
    country: 'VN',
    isDefault: false,
    ...overrides,
  });
}

const valid = {
  ...EMPTY_ADDRESS_FORM,
  recipientName: 'Nguyen Van A',
  phone: '+84 901 234 567',
  line1: '1 Le Loi',
  ward: 'Ben Nghe',
  district: 'District 1',
  city: 'Ho Chi Minh',
};

describe('address form validation (core schema)', () => {
  it('accepts a complete Vietnamese address; country defaults to VN, blank line2 is dropped', () => {
    const result = validateNewAddress(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.country).toBe('VN');
      expect(result.value.line2).toBeUndefined();
      expect(result.value.isDefault).toBe(false);
    }
  });

  it('maps problems to translatable keys per field, never to core English text', () => {
    const result = validateNewAddress({ ...valid, recipientName: '  ', phone: 'abc', ward: '' });
    expect(result).toEqual({
      ok: false,
      errors: {
        recipientName: 'form.required',
        phone: 'form.invalid',
        ward: 'form.required',
      },
    });
  });

  it('flags a too-long field and a bad country code', () => {
    const result = validateNewAddress({ ...valid, line1: 'x'.repeat(201), country: 'vn' });
    expect(result).toEqual({
      ok: false,
      errors: { line1: 'form.tooLong', country: 'form.invalid' },
    });
  });
});

describe('address edit', () => {
  const original = address(1, { line2: 'Floor 2' });

  it('sends only the changed fields', () => {
    const result = validateAddressEdit(original, {
      ...addressToFormValues(original),
      phone: '0911111111',
    });
    expect(result).toEqual({ ok: true, value: { phone: '0911111111' } });
  });

  it('clears line2 with null when the field is blanked', () => {
    const result = validateAddressEdit(original, { ...addressToFormValues(original), line2: '' });
    expect(result).toEqual({ ok: true, value: { line2: null } });
  });

  it('reports "nothing changed" as a null patch and keeps required fields required', () => {
    expect(validateAddressEdit(original, addressToFormValues(original))).toEqual({
      ok: true,
      value: null,
    });
    const blank = validateAddressEdit(original, { ...addressToFormValues(original), city: '' });
    expect(blank).toEqual({ ok: false, errors: { city: 'form.required' } });
  });
});

describe('address list ordering', () => {
  const list = [address(3), address(2, { isDefault: true }), address(1)];

  it('puts the default first and keeps the API order of the rest', () => {
    expect(sortAddresses(list).map((a) => a.id)).toEqual([id(2), id(3), id(1)]);
    expect(list.map((a) => a.id)).toEqual([id(3), id(2), id(1)]); // input untouched
  });

  it('set-default leaves exactly one default, listed first', () => {
    const next = withDefault(list, id(1));
    expect(next.map((a) => [a.id, a.isDefault])).toEqual([
      [id(1), true],
      [id(3), false],
      [id(2), false],
    ]);
  });

  it('deleting the default promotes the newest remaining address', () => {
    const next = withoutAddress(sortAddresses(list), id(2));
    expect(next.map((a) => [a.id, a.isDefault])).toEqual([
      [id(3), true],
      [id(1), false],
    ]);
  });

  it('deleting a non-default row keeps the default; deleting the last row empties the list', () => {
    expect(withoutAddress(sortAddresses(list), id(1)).map((a) => a.id)).toEqual([id(2), id(3)]);
    expect(withoutAddress([address(1, { isDefault: true })], id(1))).toEqual([]);
  });
});

describe('newIdempotencyKey', () => {
  it('produces a canonical ULID (what the API requires)', () => {
    expect(UlidSchema.safeParse(newIdempotencyKey()).success).toBe(true);
  });

  it('is time-ordered and encodes the timestamp in the first 10 chars', () => {
    const zero = () => new Uint8Array(10);
    const a = newIdempotencyKey(1_700_000_000_000, zero);
    const b = newIdempotencyKey(1_700_000_000_001, zero);
    expect(a < b).toBe(true);
    expect(a.slice(10)).toBe('0'.repeat(16));
  });
});
