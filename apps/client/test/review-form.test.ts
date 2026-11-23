import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api/errors';
import { describeError, errorCodeOfThrown } from '../src/lib/api/error-message';
import {
  REVIEW_BODY_MAX_LENGTH,
  isReviewDone,
  reviewProblemKey,
  reviewSubOrderParam,
  validateReview,
} from '../src/lib/review-form';

const SUB = '01JD0000000000000000000001';

describe('validateReview (core schema)', () => {
  it('accepts a 1–5 rating with an optional trimmed body', () => {
    expect(validateReview({ subOrderId: SUB, rating: 5, body: '  Great  ' })).toMatchObject({
      ok: true,
      value: { rating: 5, body: 'Great' },
    });
    const blank = validateReview({ subOrderId: SUB, rating: 1, body: '   ' });
    expect(blank).toMatchObject({ ok: true });
    if (blank.ok) expect(blank.value.body).toBeUndefined();
  });

  it('requires a rating between 1 and 5', () => {
    for (const rating of [0, 6, 2.5, Number.NaN]) {
      expect(validateReview({ subOrderId: SUB, rating, body: '' })).toEqual({
        ok: false,
        problem: 'rating',
      });
    }
  });

  it('caps the body at 2000 characters', () => {
    expect(
      validateReview({ subOrderId: SUB, rating: 4, body: 'x'.repeat(REVIEW_BODY_MAX_LENGTH) }).ok,
    ).toBe(true);
    expect(
      validateReview({ subOrderId: SUB, rating: 4, body: 'x'.repeat(REVIEW_BODY_MAX_LENGTH + 1) }),
    ).toEqual({ ok: false, problem: 'body' });
  });

  it('rejects a malformed sub-order id', () => {
    expect(validateReview({ subOrderId: 'nope', rating: 3, body: '' })).toEqual({
      ok: false,
      problem: 'subOrder',
    });
  });

  it('maps client problems to catalog keys', () => {
    expect(reviewProblemKey('rating')).toBe('review.ratingRequired');
    expect(reviewProblemKey('body')).toBe('form.tooLong');
  });
});

describe('review error mapping', () => {
  it('treats "already reviewed" as done and other codes as retryable', () => {
    expect(isReviewDone('review.error.already-exists')).toBe(true);
    expect(isReviewDone('review.error.not-eligible')).toBe(false);
    expect(isReviewDone(null)).toBe(false);
  });

  it('translates the API error code per locale (review.error.*)', () => {
    const notEligible = new ApiError(422, 'review.error.not-eligible');
    expect(errorCodeOfThrown(notEligible)).toBe('review.error.not-eligible');
    expect(describeError('en', notEligible)).toBe(
      'You can only review a product after it has been delivered.',
    );
    expect(describeError('vi', new ApiError(409, 'review.error.already-exists'))).toBe(
      'Bạn đã đánh giá sản phẩm này rồi.',
    );
  });

  it('falls back to the generic message for network failures and unknown codes', () => {
    const generic = describeError('en', new ApiError(500, null));
    expect(describeError('en', new TypeError('Failed to fetch'))).toBe(generic);
    expect(describeError('en', new ApiError(418, 'brand.new.code'))).toBe(generic);
  });
});

describe('reviewSubOrderParam', () => {
  it('accepts only a ULID (the ?reviewSubOrderId= entry point)', () => {
    expect(reviewSubOrderParam(SUB)).toBe(SUB);
    expect(reviewSubOrderParam('01jd0000000000000000000001')).toBeNull();
    expect(reviewSubOrderParam('<script>')).toBeNull();
    expect(reviewSubOrderParam(null)).toBeNull();
  });
});
