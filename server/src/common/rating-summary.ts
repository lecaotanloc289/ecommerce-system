import type { RatingSummary } from '@repo/core';
import type { PrismaService } from '../prisma/prisma.service';

const STAR_LEVELS = [1, 2, 3, 4, 5] as const;
export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Aggregate of a product's reviews: `average` (2 dp, null when none), `count`, per-star `distribution`. */
export async function computeRatingSummary(
  prisma: PrismaService,
  productId: string,
): Promise<RatingSummary> {
  const groups = await prisma.client.review.groupBy({
    by: ['rating'],
    where: { productId },
    _count: { _all: true },
  });
  const counts = STAR_LEVELS.map((star) => groups.find((g) => g.rating === star)?._count._all ?? 0);
  const count = counts.reduce((a, b) => a + b, 0);
  const weighted = counts.reduce((sum, n, i) => sum + n * (i + 1), 0);
  return {
    average: count === 0 ? null : round2(weighted / count),
    count,
    distribution: [counts[0] ?? 0, counts[1] ?? 0, counts[2] ?? 0, counts[3] ?? 0, counts[4] ?? 0],
  };
}
