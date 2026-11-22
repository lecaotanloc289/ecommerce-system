import { Injectable } from '@nestjs/common';
import {
  DomainError,
  type PlatformOrderDetail,
  PlatformOrderDetailSchema,
  type PlatformOrderListQuery,
  type PlatformOrderPage,
  PlatformOrderPageSchema,
} from '@repo/core';
import { type Prisma, toMoney } from '@repo/db';
import { cursorPageArgs, toPage } from '../common/pagination';
import { ORDER_DETAIL_ARGS, toOrder } from '../orders/order-view';
import { PrismaService } from '../prisma/prisma.service';

const CUSTOMER = { select: { name: true, email: true } } as const;

const LIST_ARGS = {
  include: { customer: CUSTOMER, _count: { select: { subOrders: true } } },
} satisfies Prisma.OrderDefaultArgs;

const DETAIL_ARGS = {
  include: {
    ...ORDER_DETAIL_ARGS.include,
    customer: CUSTOMER,
    payments: { orderBy: { attemptNo: 'asc' } },
    ledgerEntries: { orderBy: { id: 'asc' } },
  },
} satisfies Prisma.OrderDefaultArgs;

/** Read-only order oversight for platform staff (refunds are T3.5's endpoint, not here). */
@Injectable()
export class PlatformOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PlatformOrderListQuery): Promise<PlatformOrderPage> {
    const args = cursorPageArgs(query);
    const rows = await this.prisma.client.order.findMany({
      ...args,
      where: {
        ...(query.status && { status: query.status }),
        ...(query.q && {
          OR: [
            { id: { startsWith: query.q.toUpperCase() } },
            { customer: { email: { contains: query.q, mode: 'insensitive' } } },
          ],
        }),
        ...args.where,
      },
      ...LIST_ARGS,
    });
    const page = toPage(rows, query);
    return PlatformOrderPageSchema.parse({
      items: page.items.map((o) => ({
        id: o.id,
        status: o.status,
        grandTotal: toMoney(o.grandTotalAmount, o.currency),
        subOrderCount: o._count.subOrders,
        customerId: o.customerId,
        customerName: o.customer.name,
        customerEmail: o.customer.email,
        createdAt: o.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    });
  }

  async get(id: string): Promise<PlatformOrderDetail> {
    const row = await this.prisma.client.order.findUnique({ where: { id }, ...DETAIL_ARGS });
    if (!row) throw new DomainError('order.error.not-found', { id });
    const refunds = await this.prisma.client.refund.findMany({
      where: { subOrder: { orderId: id } },
      orderBy: { id: 'asc' },
    });
    return PlatformOrderDetailSchema.parse({
      ...toOrder(row),
      customerId: row.customerId,
      customerName: row.customer.name,
      customerEmail: row.customer.email,
      // `rawPayload` and `redirectUrl` (a live provider checkout link) are deliberately not mapped.
      payments: row.payments.map((p) => ({
        id: p.id,
        attemptNo: p.attemptNo,
        provider: p.provider,
        status: p.status,
        amount: toMoney(p.amount, p.currency),
        providerTxnId: p.providerTxnId,
        expiresAt: p.expiresAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      ledgerEntries: row.ledgerEntries.map((e) => ({
        id: e.id,
        txnGroupId: e.txnGroupId,
        account: e.account,
        entryType: e.entryType,
        amount: toMoney(e.amount, e.currency),
        orderId: e.orderId,
        subOrderId: e.subOrderId,
        createdAt: e.createdAt.toISOString(),
      })),
      refunds: refunds.map((r) => ({
        id: r.id,
        subOrderId: r.subOrderId,
        paymentId: r.paymentId,
        amount: toMoney(r.amount, r.currency),
        status: r.status,
        reason: r.reason,
        providerRefundId: r.providerRefundId,
        requestedById: r.requestedById,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  }
}
