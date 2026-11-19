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

/** Create/update body for a customer address (POST/PUT /v1/addresses). */
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
