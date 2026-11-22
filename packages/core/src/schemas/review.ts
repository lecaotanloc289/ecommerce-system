import { z } from 'zod';
import { ProductIdSchema, ReviewIdSchema, SubOrderIdSchema } from '../ids';
import { IsoDateTimeSchema } from './datetime';

const RatingSchema = z.number().int().min(1).max(5);

/**
 * Body of `POST /v1/reviews`. The author comes from the token; the server checks the sub-order
 * belongs to the caller, is DELIVERED/COMPLETED and contains the product.
 */
export const ReviewCreateSchema = z.object({
  subOrderId: SubOrderIdSchema,
  productId: ProductIdSchema,
  rating: RatingSchema,
  body: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
});
export type ReviewCreate = z.infer<typeof ReviewCreateSchema>;

export const ReviewSchema = z.object({
  id: ReviewIdSchema,
  productId: ProductIdSchema,
  authorName: z.string().min(1),
  rating: RatingSchema,
  body: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Review = z.infer<typeof ReviewSchema>;

/** Aggregate for a product. `distribution[i]` = number of (i+1)-star reviews. */
export const RatingSummarySchema = z.object({
  /** `null` when the product has no reviews yet. */
  average: z.number().min(0).max(5).nullable(),
  count: z.number().int().nonnegative(),
  distribution: z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
  ]),
});
export type RatingSummary = z.infer<typeof RatingSummarySchema>;
