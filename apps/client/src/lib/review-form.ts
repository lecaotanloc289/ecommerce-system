import { REVIEW_BODY_MAX_LENGTH, ReviewCreateBodySchema, type ReviewCreateBody } from '@repo/core';
import type { MessageKey } from '@repo/i18n';

export type ReviewFormProblem = 'rating' | 'body' | 'subOrder';

export type ReviewValidation =
  | { ok: true; value: ReviewCreateBody }
  | { ok: false; problem: ReviewFormProblem };

/** Validate the review form with the core schema (rating 1–5, body ≤ 2000, valid sub-order id). */
export function validateReview(input: {
  subOrderId: string;
  rating: number;
  body: string;
}): ReviewValidation {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, problem: 'rating' };
  }
  const parsed = ReviewCreateBodySchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  const first = parsed.error.issues[0]?.path[0];
  return {
    ok: false,
    problem: first === 'body' ? 'body' : first === 'rating' ? 'rating' : 'subOrder',
  };
}

export { REVIEW_BODY_MAX_LENGTH };

/**
 * `review.error.*` codes the form handles itself (the generic message fits, shown via
 * `translateError`): not-eligible, already-exists. `already-exists` also means the work is
 * done, so the form closes instead of offering a retry.
 */
export function isReviewDone(errorCode: string | null): boolean {
  return errorCode === 'review.error.already-exists';
}

/** Message key for a client-side problem. */
export function reviewProblemKey(problem: ReviewFormProblem): MessageKey {
  switch (problem) {
    case 'rating':
      return 'review.ratingRequired';
    case 'body':
      return 'form.tooLong';
    case 'subOrder':
      return 'form.invalid';
  }
}

/** The `?reviewSubOrderId=` entry-point parameter a product link carries, or null when it isn't a ULID. */
export function reviewSubOrderParam(value: string | null | undefined): string | null {
  return value && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value) ? value : null;
}
