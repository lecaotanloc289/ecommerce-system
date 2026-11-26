import { Injectable } from '@nestjs/common';
import {
  type CrmCustomerDetail,
  CrmCustomerDetailSchema,
  type CrmCustomerListQuery,
  type CrmCustomerPage,
  CrmCustomerPageSchema,
  type CrmCustomerSummarySchema,
  type CrmSegmentCounts,
  CrmSegmentCountsSchema,
  DomainError,
  type Money,
  type ReplaceCustomerTags,
  ReplaceCustomerTagsSchema,
  type SubOrderStatus,
} from '@repo/core';
import { toMoney } from '@repo/db';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { assertVendorActive } from '../vendor/vendor-scope';
import { isVendorOwner } from './crm-access';
import { decodeCustomerCursor, encodeCustomerCursor } from './crm-cursor';
import { CrmCustomersRepository, type CrmCustomerRow } from './crm-customers.repository';
import { type CrmCustomerNote, CrmCustomerNoteSchema } from './crm.dto';
import type { z } from 'zod';

/** Sub-orders shown in a customer's history: paid ones (incl. REFUNDED), like the vendor order list. */
const HISTORY_STATUSES: readonly SubOrderStatus[] = [
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
  'REFUNDED',
];
const MAX_RECENT_ORDERS = 20;
const MAX_REVIEWS = 20;
const MAX_NOTES = 50;

/** Postgres `text` cannot hold NUL: reject it as a validation error instead of a 500. */
function assertNoNul(field: string, value: string | undefined): void {
  if (value?.includes('\u0000') === true) {
    throw new DomainError('common.error.validation-failed', { field });
  }
}

function toSummary(
  row: CrmCustomerRow,
  province: string | null,
  spend: readonly Money[],
): z.input<typeof CrmCustomerSummarySchema> {
  return {
    customerId: row.customerId,
    name: row.name,
    avatarUrl: row.avatarUrl,
    province,
    orderCount: row.orderCount,
    firstOrderAt: row.firstOrderAt.toISOString(),
    lastOrderAt: row.lastOrderAt.toISOString(),
    spend: [...spend],
    segment: row.segment,
    tags: row.tags,
    marketingOptIn: row.marketingOptIn,
  };
}

/** An author whose account was deleted (`authorId` SetNull) has no name: the client shows a placeholder. */
const noteView = (n: {
  id: string;
  body: string;
  createdAt: Date;
  author: { name: string } | null;
}): z.input<typeof CrmCustomerNoteSchema> => ({
  id: n.id,
  authorName: n.author?.name ?? '',
  body: n.body,
  createdAt: n.createdAt.toISOString(),
});

/**
 * Vendor CRM customer views (C1–C4): list / 360 detail / segments read stats computed on read;
 * tags and notes are vendor-internal. Never selects email, phone or a street address.
 */
@Injectable()
export class CrmCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: CrmCustomersRepository,
  ) {}

  /**
   * One page; thresholds, page rows, province and spend are read in ONE REPEATABLE READ snapshot,
   * so an order landing mid-request cannot make the summary disagree with its own stats.
   */
  async list(vendorId: string, query: CrmCustomerListQuery): Promise<CrmCustomerPage> {
    assertNoNul('q', query.q);
    assertNoNul('tag', query.tag);
    const sort = query.sort ?? 'last_order';
    const after = query.cursor === undefined ? null : decodeCustomerCursor(query.cursor, sort);
    const { rows, provinces, spend } = await this.prisma.client.$transaction(
      async (tx) => {
        const page = await this.repo.customers(
          tx,
          vendorId,
          {
            segments: query.segment === undefined ? undefined : [query.segment],
            tags: query.tag === undefined ? undefined : [query.tag],
            productIds: query.productId === undefined ? undefined : [query.productId],
            q: query.q,
          },
          { sort, after, limit: query.limit + 1 },
          new Date(),
          await this.repo.thresholds(tx),
        );
        const ids = page.slice(0, query.limit).map((r) => r.customerId);
        return {
          rows: page,
          provinces: await this.repo.provinces(tx, vendorId, ids),
          spend: await this.repo.spend(tx, vendorId, ids),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    const nextCursor =
      rows.length > query.limit && last !== undefined
        ? encodeCustomerCursor(
            sort === 'last_order'
              ? { sort, lastOrderAt: last.lastOrderAt, customerId: last.customerId }
              : { sort, orderCount: last.orderCount, customerId: last.customerId },
          )
        : null;
    return CrmCustomerPageSchema.parse({
      items: items.map((r) =>
        toSummary(r, provinces.get(r.customerId) ?? null, spend.get(r.customerId) ?? []),
      ),
      nextCursor,
    });
  }

  /** 360 view; a user who is not a customer of this vendor is 404 (existence is not leaked). */
  async detail(vendorId: string, customerId: string): Promise<CrmCustomerDetail> {
    const snapshot = await this.prisma.client.$transaction(
      async (tx) => {
        const [row] = await this.repo.customers(
          tx,
          vendorId,
          { customerId },
          { sort: 'last_order', after: null, limit: 1 },
          new Date(),
          await this.repo.thresholds(tx),
        );
        if (!row) return null;
        return {
          row,
          provinces: await this.repo.provinces(tx, vendorId, [customerId]),
          spend: await this.repo.spend(tx, vendorId, [customerId]),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    if (!snapshot) throw new DomainError('crm.error.not-a-customer');
    const { row, provinces, spend } = snapshot;

    const db = this.prisma.client;
    const [subOrders, reviews, notes] = await Promise.all([
      db.subOrder.findMany({
        where: { vendorId, order: { customerId }, status: { in: [...HISTORY_STATUSES] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_RECENT_ORDERS,
        select: {
          id: true,
          orderId: true,
          status: true,
          createdAt: true,
          currency: true,
          subtotalAmount: true,
          shippingAmount: true,
          discountAmount: true,
          platformDiscountAmount: true,
          items: { select: { productTitleSnapshot: true }, orderBy: { id: 'asc' } },
        },
      }),
      db.review.findMany({
        where: { authorId: customerId, product: { vendorId } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_REVIEWS,
        select: { productId: true, rating: true, body: true, createdAt: true },
      }),
      db.vendorCustomerNote.findMany({
        where: { vendorId, userId: customerId, deletedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_NOTES,
        select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
      }),
    ]);

    return CrmCustomerDetailSchema.parse({
      ...toSummary(row, provinces.get(customerId) ?? null, spend.get(customerId) ?? []),
      serviceOptOut: row.serviceOptOut,
      recentOrders: subOrders.map((so) => ({
        subOrderId: so.id,
        orderId: so.orderId,
        status: so.status,
        createdAt: so.createdAt.toISOString(),
        // paid_i (C2) = subtotal + shipping − vendor discount − platform discount
        total: toMoney(
          so.subtotalAmount + so.shippingAmount - so.discountAmount - so.platformDiscountAmount,
          so.currency,
        ),
        itemTitles: so.items.map((i) => i.productTitleSnapshot),
      })),
      reviews: reviews.map((r) => ({
        productId: r.productId,
        rating: r.rating,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
      })),
      notes: notes.map(noteView),
    });
  }

  async segments(vendorId: string): Promise<CrmSegmentCounts> {
    const db = this.prisma.client;
    const counts = await this.repo.segmentCounts(
      db,
      vendorId,
      new Date(),
      await this.repo.thresholds(db),
    );
    return CrmSegmentCountsSchema.parse({
      segments: counts,
      totalCustomers: counts.reduce((sum, c) => sum + c.customers, 0),
    });
  }

  /** Replaces the vendor-internal tags of one customer (upserts `vendor_customers`). */
  async replaceTags(
    vendorId: string,
    customerId: string,
    body: ReplaceCustomerTags,
  ): Promise<ReplaceCustomerTags> {
    const saved = await this.prisma.client.$transaction(async (tx) => {
      await assertVendorActive(tx, vendorId);
      if (!(await this.repo.isCustomer(tx, vendorId, customerId))) {
        throw new DomainError('crm.error.not-a-customer');
      }
      return tx.vendorCustomer.upsert({
        where: { vendorId_userId: { vendorId, userId: customerId } },
        create: { vendorId, userId: customerId, tags: body.tags },
        update: { tags: body.tags },
        select: { tags: true },
      });
    });
    return ReplaceCustomerTagsSchema.parse({ tags: saved.tags });
  }

  async addNote(
    authorId: string,
    vendorId: string,
    customerId: string,
    body: string,
  ): Promise<CrmCustomerNote> {
    const note = await this.prisma.client.$transaction(async (tx) => {
      await assertVendorActive(tx, vendorId);
      if (!(await this.repo.isCustomer(tx, vendorId, customerId))) {
        throw new DomainError('crm.error.not-a-customer');
      }
      return tx.vendorCustomerNote.create({
        data: { id: ulid(), vendorId, userId: customerId, authorId, body },
        select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
      });
    });
    return CrmCustomerNoteSchema.parse(noteView(note));
  }

  /** Soft delete by its author or the vendor owner (C13); others' / deleted notes are 404. */
  async deleteNote(
    userId: string,
    vendorId: string,
    customerId: string,
    noteId: string,
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await assertVendorActive(tx, vendorId);
      const note = await tx.vendorCustomerNote.findFirst({
        where: { id: noteId, vendorId, userId: customerId, deletedAt: null },
        select: { authorId: true },
      });
      if (!note) throw new DomainError('crm.error.note-not-found');
      if (note.authorId !== userId && !(await isVendorOwner(tx, userId, vendorId))) {
        throw new DomainError('common.error.forbidden');
      }
      const { count } = await tx.vendorCustomerNote.updateMany({
        where: { id: noteId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw new DomainError('crm.error.note-not-found');
    });
  }
}
