import { Injectable } from '@nestjs/common';
import {
  DomainError,
  ReviewSchema,
  type PageQuery,
  type Review,
  type ReviewCreateBody,
  type ReviewPage,
} from '@repo/core';
import { monotonicFactory } from 'ulid';
import { cursorPageArgs, toPage } from '../common/pagination';
import { computeRatingSummary } from '../common/rating-summary';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../vendor/vendor-scope';

const ulid = monotonicFactory();
const VISIBLE_PRODUCT = { status: 'ACTIVE', vendor: { status: 'ACTIVE' } } as const;

interface ReviewRow {
  id: string;
  productId: string;
  rating: number;
  body: string | null;
  createdAt: Date;
  author: { name: string };
}

function toReview(row: ReviewRow): Review {
  return ReviewSchema.parse({
    id: row.id,
    productId: row.productId,
    // Display name only: the author's email never leaves the server.
    authorName: row.author.name.trim() || '*',
    rating: row.rating,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  });
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /** `GET /v1/products/:id/reviews` — only for visible products, else 404. */
  async list(productId: string, query: PageQuery): Promise<ReviewPage> {
    const visible = await this.prisma.client.product.findFirst({
      where: { id: productId, ...VISIBLE_PRODUCT },
      select: { id: true },
    });
    if (!visible) throw new DomainError('product.error.not-found', { id: productId });

    const args = cursorPageArgs(query, 'desc');
    const [rows, summary] = await Promise.all([
      this.prisma.client.review.findMany({
        ...args,
        where: { productId, ...args.where },
        include: { author: { select: { name: true } } },
      }),
      computeRatingSummary(this.prisma, productId),
    ]);
    const page = toPage(rows, query);
    return { items: page.items.map(toReview), nextCursor: page.nextCursor, summary };
  }

  /** `POST /v1/products/:id/reviews`. The author is always the caller. */
  async create(userId: string, productId: string, input: ReviewCreateBody): Promise<Review> {
    // One query covers every eligibility rule: own order, delivered, contains this product.
    const eligible = await this.prisma.client.subOrder.findFirst({
      where: {
        id: input.subOrderId,
        order: { customerId: userId },
        status: { in: ['DELIVERED', 'COMPLETED'] },
        items: { some: { variant: { productId } } },
      },
      select: { id: true },
    });
    if (!eligible) throw new DomainError('review.error.not-eligible', { productId });

    const existing = await this.prisma.client.review.findUnique({
      where: {
        authorId_subOrderId_productId: {
          authorId: userId,
          subOrderId: input.subOrderId,
          productId,
        },
      },
      select: { id: true },
    });
    if (existing) throw new DomainError('review.error.already-exists', { productId });

    try {
      const row = await this.prisma.client.review.create({
        data: {
          id: ulid(),
          productId,
          authorId: userId,
          subOrderId: input.subOrderId,
          rating: input.rating,
          body: input.body ?? null,
        },
        include: { author: { select: { name: true } } },
      });
      return toReview(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError('review.error.already-exists', { productId });
      }
      throw error;
    }
  }
}
