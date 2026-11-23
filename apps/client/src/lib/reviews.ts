import type { RatingSummary } from '@repo/core';

export interface RatingBar {
  stars: 1 | 2 | 3 | 4 | 5;
  count: number;
  /** Whole percent of all reviews (0 when there are none). */
  percent: number;
}

/** 5★ → 1★ bars from `distribution[i]` = number of (i+1)-star reviews. */
export function ratingBars(summary: Pick<RatingSummary, 'distribution'>): RatingBar[] {
  const [one, two, three, four, five] = summary.distribution;
  const total = one + two + three + four + five;
  const bar = (stars: RatingBar['stars'], count: number): RatingBar => ({
    stars,
    count,
    percent: total === 0 ? 0 : Math.round((count / total) * 100),
  });
  return [bar(5, five), bar(4, four), bar(3, three), bar(2, two), bar(1, one)];
}
