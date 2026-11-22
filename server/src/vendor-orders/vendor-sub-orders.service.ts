import { Injectable } from '@nestjs/common';
import {
  DomainError,
  Money,
  type SubOrderShip,
  type VendorSubOrder,
  type VendorSubOrderPage,
  VendorSubOrderPageSchema,
  type VendorSubOrderQuery,
  VendorSubOrderSchema,
  VendorSubOrderStatusSchema,
} from '@repo/core';
import { toMoney } from '@repo/db';
import { cursorPageArgs, toPage } from '../common/pagination';
import { SUB_ORDER_DETAIL_ARGS, type SubOrderDetailRow, toSubOrder } from '../orders/order-view';
import { type FulfilmentTarget, transitionSubOrder } from '../orders/sub-order-transition';
import { PrismaService } from '../prisma/prisma.service';

/** Sub-orders a vendor may see: paid ones only (unpaid / cancelled-unpaid are 404 / absent). */
const VISIBLE_STATUSES = VendorSubOrderStatusSchema.options;

/** Owning vendor's view: customer view + commission snapshot + `net` (D7). */
export function toVendorSubOrder(row: SubOrderDetailRow): VendorSubOrder {
  const money = (amount: bigint) => toMoney(amount, row.currency);
  const commission = money(row.commissionAmount);
  // net_i (D7) = subtotal + shipping − vendorDiscount − commission (platform coupons are platform-funded)
  const net = Money.subtract(
    Money.subtract(
      Money.add(money(row.subtotalAmount), money(row.shippingAmount)),
      money(row.discountAmount),
    ),
    commission,
  );
  return VendorSubOrderSchema.parse({ ...toSubOrder(row), commission, net });
}

/**
 * Vendor fulfilment (T3.3): the vendor's sub-orders and the PAID → PROCESSING → SHIPPED →
 * DELIVERED moves. Every query is scoped by the `vendorId` from `req.user`; another vendor's
 * sub-order is 404 `sub-order.error.not-found`.
 */
@Injectable()
export class VendorSubOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(vendorId: string, query: VendorSubOrderQuery): Promise<VendorSubOrderPage> {
    const args = cursorPageArgs(query, 'desc');
    const rows = await this.prisma.client.subOrder.findMany({
      ...args,
      where: { vendorId, status: query.status ?? { in: VISIBLE_STATUSES }, ...args.where },
      ...SUB_ORDER_DETAIL_ARGS,
    });
    const page = toPage(rows, query);
    return VendorSubOrderPageSchema.parse({
      items: page.items.map(toVendorSubOrder),
      nextCursor: page.nextCursor,
    });
  }

  async get(vendorId: string, id: string): Promise<VendorSubOrder> {
    const row = await this.prisma.client.subOrder.findFirst({
      where: { id, vendorId, status: { in: VISIBLE_STATUSES } },
      ...SUB_ORDER_DETAIL_ARGS,
    });
    if (!row) throw new DomainError('sub-order.error.not-found');
    return toVendorSubOrder(row);
  }

  /** PAID → PROCESSING. */
  accept(vendorId: string, id: string): Promise<VendorSubOrder> {
    return this.move(vendorId, id, { to: 'PROCESSING', actor: 'VENDOR' });
  }

  /** PROCESSING → SHIPPED with carrier + tracking number (`shippedAt` = now). */
  ship(vendorId: string, id: string, ship: SubOrderShip): Promise<VendorSubOrder> {
    return this.move(vendorId, id, { to: 'SHIPPED', actor: 'VENDOR', ship });
  }

  /** SHIPPED → DELIVERED (`deliveredAt` = now). */
  deliver(vendorId: string, id: string): Promise<VendorSubOrder> {
    return this.move(vendorId, id, { to: 'DELIVERED', actor: 'VENDOR' });
  }

  private async move(
    vendorId: string,
    id: string,
    target: FulfilmentTarget,
  ): Promise<VendorSubOrder> {
    await this.prisma.client.$transaction(async (tx) => {
      const so = await tx.subOrder.findFirst({
        where: { id, vendorId, status: { in: VISIBLE_STATUSES } },
        select: { orderId: true, order: { select: { customerId: true } } },
      });
      if (!so) throw new DomainError('sub-order.error.not-found');
      await transitionSubOrder(
        tx,
        { subOrderId: id, orderId: so.orderId, vendorId, customerId: so.order.customerId },
        target,
      );
    });
    return this.get(vendorId, id);
  }
}
