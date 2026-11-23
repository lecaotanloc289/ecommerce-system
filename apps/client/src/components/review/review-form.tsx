'use client';

import * as React from 'react';
import { Star } from 'lucide-react';
import { Alert, AlertDescription, Button, Label, Textarea } from '@repo/ui';
import type { Review } from '@repo/core';
import { createReview } from '@/lib/api/account';
import { describeError, errorCodeOfThrown } from '@/lib/api/error-message';
import { newIdempotencyKey } from '@/lib/idempotency';
import {
  REVIEW_BODY_MAX_LENGTH,
  isReviewDone,
  reviewProblemKey,
  validateReview,
  type ReviewFormProblem,
} from '@/lib/review-form';
import { useLocale } from '@/i18n/use-locale';
import { cn } from '@/lib/utils';

/**
 * Review form: 1–5 star rating + optional text, `POST /v1/products/:id/reviews`. Reusable from
 * the product page (`?reviewSubOrderId=`) and the order detail (T5.1 links to
 * `/product/<slug>?reviewSubOrderId=<id>#reviews`). `onCreated` gets the stored review; an
 * "already reviewed" reply also ends the flow through `onAlreadyReviewed`.
 */
export function ReviewForm({
  productId,
  subOrderId,
  onCreated,
  onAlreadyReviewed,
  className,
}: {
  productId: string;
  subOrderId: string;
  onCreated: (review: Review) => void;
  onAlreadyReviewed?: () => void;
  className?: string;
}) {
  const { locale, t } = useLocale();
  const groupId = React.useId();
  const [rating, setRating] = React.useState(0);
  const [body, setBody] = React.useState('');
  const [problem, setProblem] = React.useState<ReviewFormProblem | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // One key per user action: a retry of the same submit replays the first response.
  const keyRef = React.useRef<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setServerError(null);
    const checked = validateReview({ subOrderId, rating, body });
    if (!checked.ok) return setProblem(checked.problem);
    setProblem(null);
    setBusy(true);
    keyRef.current ??= newIdempotencyKey();
    try {
      onCreated(await createReview(productId, checked.value, keyRef.current));
    } catch (error) {
      if (isReviewDone(errorCodeOfThrown(error))) onAlreadyReviewed?.();
      setServerError(describeError(locale, error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      className={cn('flex flex-col gap-4 rounded-xl border border-border-subtle p-5', className)}
    >
      <h3 className="text-body-l font-semibold text-text-primary">{t('review.title')}</h3>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-body-s font-medium text-text-body">
          {t('review.rating')}
        </legend>
        <div className="flex items-center gap-1" role="radiogroup" aria-label={t('review.rating')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="cursor-pointer rounded focus-within:ring-2 focus-within:ring-border-focus"
            >
              <input
                type="radio"
                name={groupId}
                value={n}
                checked={rating === n}
                onChange={() => {
                  setRating(n);
                  keyRef.current = null;
                }}
                className="sr-only"
                aria-label={t('review.ratingOption', { n })}
              />
              <Star
                aria-hidden
                className={cn(
                  'size-7',
                  n <= rating
                    ? 'fill-warning-solid text-warning-solid'
                    : 'fill-transparent text-border-default',
                )}
              />
            </label>
          ))}
        </div>
        {problem === 'rating' ? (
          <p role="alert" className="text-body-s text-danger-fg">
            {t(reviewProblemKey('rating'))}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${groupId}-body`}>{t('review.body')}</Label>
        <Textarea
          id={`${groupId}-body`}
          rows={4}
          value={body}
          placeholder={t('review.bodyPlaceholder')}
          invalid={problem === 'body'}
          onChange={(e) => {
            setBody(e.target.value);
            keyRef.current = null;
          }}
        />
        <div className="flex items-center justify-between text-body-s">
          <span role={problem === 'body' ? 'alert' : undefined} className="text-danger-fg">
            {problem === 'body' ? t(reviewProblemKey('body')) : ''}
          </span>
          <span className="text-text-muted">
            {t('review.bodyCount', { count: body.length, max: REVIEW_BODY_MAX_LENGTH })}
          </span>
        </div>
      </div>

      {serverError ? (
        <Alert variant="danger">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <Button type="submit" loading={busy}>
          {busy ? t('review.submitting') : t('review.submit')}
        </Button>
      </div>
    </form>
  );
}
