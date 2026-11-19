import { z } from 'zod';

/** URL slug: lowercase ASCII words joined by single hyphens (Vietnamese is transliterated first). */
export const SlugSchema = z
  .string()
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Invalid slug' });
export type Slug = z.infer<typeof SlugSchema>;

/** Absolute http(s) URL — product images and uploads are served from R2 / MinIO. */
export const HttpUrlSchema = z.url({ protocol: /^https?$/ });
export type HttpUrl = z.infer<typeof HttpUrlSchema>;
