import { z } from 'zod';
import { AddressIdSchema } from '../ids';

const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** ISO 3166-1 alpha-2, uppercase (e.g. `VN`, `US`). */
export const CountryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, { message: 'Invalid country code' });

/** Digits with optional leading `+` and spaces/dashes/parentheses; 8–15 digits overall. */
export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{6,22}$/, { message: 'Invalid phone number' })
  .refine((v) => {
    const digits = v.replace(/\D/g, '').length;
    return digits >= 8 && digits <= 15;
  }, 'Invalid phone number');

/** Create body for a customer address (POST /v1/me/addresses). */
export const AddressInputSchema = z.object({
  recipientName: requiredText(120),
  phone: PhoneSchema,
  line1: requiredText(200),
  // Blank → undefined, so the DB stores NULL (matching AddressSchema.line2) rather than ''.
  line2: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  ward: requiredText(120),
  district: requiredText(120),
  city: requiredText(120),
  country: CountryCodeSchema.default('VN'),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.infer<typeof AddressInputSchema>;

/** Address as returned by the API. Mirrors the `Address` model (nullable columns stay `null`). */
export const AddressSchema = z.object({
  id: AddressIdSchema,
  recipientName: z.string(),
  phone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  ward: z.string(),
  district: z.string(),
  city: z.string(),
  country: CountryCodeSchema,
  isDefault: z.boolean(),
});
export type Address = z.infer<typeof AddressSchema>;

/**
 * Partial update body (PATCH /v1/me/addresses/:id). Only the sent fields change; `country` has no
 * default here (omitted = unchanged). `line2: null` or blank clears it. The default flag is not
 * editable here — use `POST /v1/me/addresses/:id/default`.
 */
export const AddressUpdateSchema = z
  .object({
    recipientName: requiredText(120),
    phone: PhoneSchema,
    line1: requiredText(200),
    line2: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .transform((v) => (v === '' ? null : v)),
    ward: requiredText(120),
    district: requiredText(120),
    city: requiredText(120),
    country: CountryCodeSchema,
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'At least one field is required');
export type AddressUpdate = z.infer<typeof AddressUpdateSchema>;

/** Path params of `/v1/me/addresses/:id[/...]`. */
export const AddressParamsSchema = z.object({ id: AddressIdSchema });
export type AddressParams = z.infer<typeof AddressParamsSchema>;
