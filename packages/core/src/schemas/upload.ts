import { z } from 'zod';
import { HttpUrlSchema } from './common';
import { IsoDateTimeSchema } from './datetime';

/** What an upload is for — decides the bucket (`kyc` private, others public `media`) and size/type rules. */
export const UploadPurposeSchema = z.enum(['kyc', 'product-image', 'vendor-logo']);
export type UploadPurpose = z.infer<typeof UploadPurposeSchema>;

/** Hard payload ceiling (bytes). Per-purpose limits are enforced by the server. */
const MAX_PRESIGN_SIZE_BYTES = 20 * 1024 * 1024;

/**
 * Object key returned by a presign call and echoed back in later requests (vendor application,
 * product images, logo). The server verifies the key belongs to the caller before saving it.
 * No leading slash and no `.`/`..` segments.
 */
export const UploadKeySchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/, {
    message: 'Invalid upload key',
  });
export type UploadKey = z.infer<typeof UploadKeySchema>;

/** Body of `POST /v1/uploads/presign`. */
export const PresignRequestSchema = z.object({
  purpose: UploadPurposeSchema,
  contentType: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]+\/[a-z0-9.+-]+$/, { message: 'Invalid content type' }),
  size: z.number().int().positive().max(MAX_PRESIGN_SIZE_BYTES),
});
export type PresignRequest = z.infer<typeof PresignRequestSchema>;

/** Presigned PUT target: the client uploads with `PUT url` + `headers`, then sends `key` onward. */
export const PresignResponseSchema = z.object({
  url: HttpUrlSchema,
  key: UploadKeySchema,
  headers: z.record(z.string(), z.string()),
  expiresAt: IsoDateTimeSchema,
});
export type PresignResponse = z.infer<typeof PresignResponseSchema>;
