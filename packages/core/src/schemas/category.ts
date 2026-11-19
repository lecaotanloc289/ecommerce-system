import { z } from 'zod';
import { LocaleSchema } from '../enums';
import { CategoryIdSchema } from '../ids';
import { SlugSchema } from './common';

/** One locale's name + slug for a category (mirrors `CategoryTranslation`). */
export const CategoryTranslationSchema = z.object({
  locale: LocaleSchema,
  name: z.string().trim().min(1).max(120),
  slug: SlugSchema,
});
export type CategoryTranslation = z.infer<typeof CategoryTranslationSchema>;

/**
 * Category read shape, already resolved to the requested locale (the API picks the
 * matching CategoryTranslation, so `name`/`slug` are in the caller's language).
 */
export const CategorySchema = z.object({
  id: CategoryIdSchema,
  parentId: CategoryIdSchema.nullable(),
  sortOrder: z.number().int(),
  name: z.string().min(1),
  slug: SlugSchema,
});
export type Category = z.infer<typeof CategorySchema>;
