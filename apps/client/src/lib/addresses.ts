import {
  AddressInputSchema,
  AddressUpdateSchema,
  type Address,
  type AddressInput,
  type AddressUpdate,
} from '@repo/core';
import { fieldErrorsOf, type FieldErrors } from './form-errors';

/** Text fields of the address form, in display order. */
export const ADDRESS_FIELDS = [
  'recipientName',
  'phone',
  'line1',
  'line2',
  'ward',
  'district',
  'city',
  'country',
] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

export interface AddressFormValues {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string;
  ward: string;
  district: string;
  city: string;
  country: string;
  isDefault: boolean;
}

export const EMPTY_ADDRESS_FORM: AddressFormValues = {
  recipientName: '',
  phone: '',
  line1: '',
  line2: '',
  ward: '',
  district: '',
  city: '',
  country: 'VN',
  isDefault: false,
};

export function addressToFormValues(address: Address): AddressFormValues {
  return {
    recipientName: address.recipientName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2 ?? '',
    ward: address.ward,
    district: address.district,
    city: address.city,
    country: address.country,
    isDefault: address.isDefault,
  };
}

export type AddressValidation<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldErrors<AddressField> };

/** Validate the create form with the core schema (the same one the API runs). */
export function validateNewAddress(values: AddressFormValues): AddressValidation<AddressInput> {
  const parsed = AddressInputSchema.safeParse(values);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, errors: fieldErrorsOf(parsed.error, ADDRESS_FIELDS) };
}

/**
 * Validate an edit: the whole form is checked with the create schema (so every field stays
 * required), then only the fields that changed are sent — `line2: null` clears it. `null`
 * value = nothing changed. `isDefault` is not editable through PATCH (`POST …/default` does that).
 */
export function validateAddressEdit(
  original: Address,
  values: AddressFormValues,
): AddressValidation<AddressUpdate | null> {
  const full = validateNewAddress(values);
  if (!full.ok) return full;
  const next = full.value;
  const patch: AddressUpdate = {};
  if (next.recipientName !== original.recipientName) patch.recipientName = next.recipientName;
  if (next.phone !== original.phone) patch.phone = next.phone;
  if (next.line1 !== original.line1) patch.line1 = next.line1;
  if ((next.line2 ?? null) !== original.line2) patch.line2 = next.line2 ?? null;
  if (next.ward !== original.ward) patch.ward = next.ward;
  if (next.district !== original.district) patch.district = next.district;
  if (next.city !== original.city) patch.city = next.city;
  if (next.country !== original.country) patch.country = next.country;
  if (Object.keys(patch).length === 0) return { ok: true, value: null };
  const checked = AddressUpdateSchema.safeParse(patch);
  return checked.success
    ? { ok: true, value: checked.data }
    : { ok: false, errors: fieldErrorsOf(checked.error, ADDRESS_FIELDS) };
}

/** Default address first, the rest keep the API order (newest first). Does not mutate. */
export function sortAddresses(addresses: readonly Address[]): Address[] {
  return [...addresses].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** Local state after `POST …/default`: exactly the chosen address is default. */
export function withDefault(addresses: readonly Address[], id: string): Address[] {
  return sortAddresses(addresses.map((a) => ({ ...a, isDefault: a.id === id })));
}

/** Local state after a delete: the API promotes the newest remaining address when needed. */
export function withoutAddress(addresses: readonly Address[], id: string): Address[] {
  const rest = addresses.filter((a) => a.id !== id);
  const removedDefault = addresses.find((a) => a.id === id)?.isDefault === true;
  if (!removedDefault || rest.length === 0 || rest.some((a) => a.isDefault)) {
    return sortAddresses(rest);
  }
  // Remaining rows are "newest first", so the first one is the newest.
  const promoted = rest[0];
  return sortAddresses(rest.map((a) => ({ ...a, isDefault: a === promoted })));
}
