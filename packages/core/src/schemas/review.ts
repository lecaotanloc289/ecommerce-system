import { z } from 'zod';
import { ProductIdSchema, ReviewIdSchema, SubOrderIdSchema } from '../ids';
import { PageSchema } from './common';
import { IsoDateTimeSchema } from './datetime';

const RatingSchema = z.number().int().min(1).max(5);

export const REVIEW_BODY_MAX_LENGTH = 2000;

/**
 * Body of `POST /v1/products/:id/reviews` (the product comes from the path). The author comes
 * from the token; the server checks the sub-order belongs to the caller, is DELIVERED/COMPLETED
 * and contains the product. `body` is trimmed; blank becomes `undefined`.
 */
export const ReviewCreateBodySchema = z.object({
  subOrderId: SubOrderIdSchema,
  rating: RatingSchema,
  body: z
    .string()
    .trim()
    .max(REVIEW_BODY_MAX_LENGTH)
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
});
export type ReviewCreateBody = z.infer<typeof ReviewCreateBodySchema>;

/** Body + product id: the full input of the review use case. */
export const ReviewCreateSchema = ReviewCreateBodySchema.extend({ productId: ProductIdSchema });
export type ReviewCreate = z.infer<typeof ReviewCreateSchema>;

/**
 * Public display name of a review author: first word + initial of the last word
 * ("Nguyễn Văn An" -> "Nguyễn A."). A single word is unchanged; blank -> "*".
 */
export function maskAuthorName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const [first] = words;
  if (first === undefined) return '*';
  if (words.length === 1) return first;
  const last = words[words.length - 1] ?? '';
  const [initial] = Array.from(last);
  return `${first} ${(initial ?? '').toUpperCase()}.`;
}

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

/** `GET /v1/products/:id/reviews`: newest first, with the product's aggregate. */
export const ReviewPageSchema = PageSchema(ReviewSchema).extend({ summary: RatingSummarySchema });
export type ReviewPage = z.infer<typeof ReviewPageSchema>;
