import { z } from 'zod';
import { UlidSchema } from '../ids';

/** URL slug: lowercase ASCII words joined by single hyphens (Vietnamese is transliterated first). */
export const SlugSchema = z
  .string()
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Invalid slug' });
export type Slug = z.infer<typeof SlugSchema>;

/** Absolute http(s) URL — product images and uploads are served from R2 / MinIO. */
export const HttpUrlSchema = z.url({ protocol: /^https?$/ });
export type HttpUrl = z.infer<typeof HttpUrlSchema>;

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/**
 * Cursor pagination query (`?cursor=<ulid>&limit=20`). The cursor is the id of the last item
 * of the previous page — ULIDs sort by creation time, so `id < cursor` is "older than".
 */
export const PageQuerySchema = z.object({
  cursor: UlidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

/** One page of `item`s; `nextCursor` is null on the last page. */
export function PageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    nextCursor: UlidSchema.nullable(),
  });
}
export type Page<Item extends z.ZodType> = z.infer<ReturnType<typeof PageSchema<Item>>>;
