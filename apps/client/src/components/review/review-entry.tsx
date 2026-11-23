'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import type { Review } from '@repo/core';
import { reviewSubOrderParam } from '@/lib/review-form';
import { Link, usePathname } from '@/i18n/navigation';
import { useT } from '@/i18n/use-locale';
import { useAuth } from '@/store/auth-provider';
import { ReviewForm } from './review-form';

/** The `?reviewSubOrderId=` of the current URL when it is a valid sub-order id, else null. */
export function useReviewSubOrderId(): string | null {
  return reviewSubOrderParam(useSearchParams().get('reviewSubOrderId'));
}

/**
 * "Write a review" entry point of the product page. Shown only when the URL carries
 * `?reviewSubOrderId=<id>` (the order detail links here for delivered sub-orders) AND the
 * visitor is signed in; the API still decides eligibility (`review.error.not-eligible`).
 */
export function ReviewEntry({
  productId,
  onCreated,
}: {
  productId: string;
  onCreated: (review: Review) => void;
}) {
  return (
    <React.Suspense fallback={null}>
      <ReviewEntryInner productId={productId} onCreated={onCreated} />
    </React.Suspense>
  );
}

function ReviewEntryInner({
  productId,
  onCreated,
}: {
  productId: string;
  onCreated: (review: Review) => void;
}) {
  const t = useT();
  const { status } = useAuth();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const subOrderId = useReviewSubOrderId();
  const [done, setDone] = React.useState(false);

  if (!subOrderId || status === 'loading') return null;
  if (status === 'anonymous') {
    const returnTo = new URLSearchParams({ returnTo: search ? `${pathname}?${search}` : pathname });
    return (
      <p className="text-body-m text-text-body">
        <Link
          href={`/sign-in?${returnTo.toString()}`}
          className="font-medium text-brand-text hover:underline"
        >
          {t('review.signInToReview')}
        </Link>
      </p>
    );
  }
  if (done) {
    return (
      <p role="status" className="text-body-m font-medium text-success-fg">
        {t('review.thanks')}
      </p>
    );
  }
  return (
    <ReviewForm
      productId={productId}
      subOrderId={subOrderId}
      onCreated={(review) => {
        setDone(true);
        onCreated(review);
      }}
      onAlreadyReviewed={() => setDone(true)}
    />
  );
}
