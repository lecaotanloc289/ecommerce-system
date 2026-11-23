import type { SubOrderStatus } from '@repo/db';
import { ulid } from 'ulid';
import { makeUser, prisma } from './fixtures';

// Fixtures for the scheduled jobs / refund / zero-amount tests: a whole order (customer, one
// vendor + wallet + product variant per sub-order, items, payment) in any state.

export function makeSettings(data: { holdPeriodDays?: number; refundWindowDays?: number } = {}) {
  return prisma.platformSettings.create({
    data: {
      id: ulid(),
      holdPeriodDays: data.holdPeriodDays ?? 7,
      refundWindowDays: data.refundWindowDays ?? 7,
      supportedCurrencies: ['VND', 'USD'],
    },
  });
}

export interface SubOrderSpec {
  status: SubOrderStatus;
  subtotal?: bigint;
  shipping?: bigint;
  discount?: bigint;
  platformDiscount?: bigint;
  commission?: bigint;
  quantity?: number;
  stockOnHand?: number;
  stockReserved?: number;
  walletCurrency?: 'VND' | 'USD' | null;
}

export interface OrderSpec {
  status: 'AWAITING_PAYMENT' | 'PAID' | 'COMPLETED' | 'CANCELLED' | 'PARTIALLY_REFUNDED';
  subOrders: SubOrderSpec[];
  /** `null` = no deadline; a number = seconds from the DB clock (negative = past). */
  deadlineInSeconds?: number | null;
  payment?: {
    status: 'PENDING' | 'CONFIRMED' | 'FAILED';
    amount?: bigint;
    providerTxnId?: string | null;
    providerRef?: string | null;
    provider?: 'VNPAY' | 'STRIPE';
  } | null;
}

const paidOf = (s: SubOrderSpec): bigint =>
  (s.subtotal ?? 100_000n) +
  (s.shipping ?? 30_000n) -
  (s.discount ?? 5_000n) -
  (s.platformDiscount ?? 0n);

export async function makeMarketOrder(spec: OrderSpec) {
  const customer = await makeUser({ name: 'Lan Nguyen' });
  const grandTotal = spec.subOrders.reduce((sum, s) => sum + paidOf(s), 0n);
  const order = await prisma.order.create({
    data: {
      id: ulid(),
      customerId: customer.id,
      status: spec.status,
      currency: 'VND',
      itemsTotalAmount: grandTotal,
      shippingTotalAmount: 0n,
      grandTotalAmount: grandTotal,
      idempotencyKey: ulid(),
    },
  });
  if (spec.deadlineInSeconds !== undefined && spec.deadlineInSeconds !== null) {
    await prisma.$executeRaw`
      UPDATE orders
      SET payment_deadline_at = (now() AT TIME ZONE 'UTC')
        + make_interval(secs => ${spec.deadlineInSeconds}::float8)
      WHERE id = ${order.id}`;
  }

  const subOrders = [];
  for (const s of spec.subOrders) {
    const owner = await makeUser({ name: 'Shop Owner' });
    const vendorId = ulid();
    const vendor = await prisma.vendor.create({
      data: {
        id: vendorId,
        ownerId: owner.id,
        slug: `shop-${vendorId.toLowerCase()}`,
        displayName: 'Lotus Shop',
        status: 'ACTIVE',
      },
    });
    const wallet =
      s.walletCurrency === null
        ? null
        : await prisma.wallet.create({
            data: { id: ulid(), vendorId, balanceCurrency: s.walletCurrency ?? 'VND' },
          });
    const product = await prisma.product.create({
      data: { id: ulid(), vendorId, status: 'ACTIVE', basePriceAmount: 50_000n },
    });
    const quantity = s.quantity ?? 2;
    const variant = await prisma.productVariant.create({
      data: {
        id: ulid(),
        productId: product.id,
        sku: `SKU-${ulid()}`,
        priceAmount: 50_000n,
        stockOnHand: s.stockOnHand ?? 10,
        stockReserved: s.stockReserved ?? quantity,
      },
    });
    const subOrder = await prisma.subOrder.create({
      data: {
        id: ulid(),
        orderId: order.id,
        vendorId,
        status: s.status,
        subtotalAmount: s.subtotal ?? 100_000n,
        shippingAmount: s.shipping ?? 30_000n,
        discountAmount: s.discount ?? 5_000n,
        platformDiscountAmount: s.platformDiscount ?? 0n,
        commissionAmount: s.commission ?? 9_500n,
        currency: 'VND',
        shippingAddress: { recipientName: 'Lan', city: 'HCM' },
        items: {
          create: {
            id: ulid(),
            variantId: variant.id,
            productTitleSnapshot: 'Basic tee',
            variantAttributesSnapshot: {},
            unitPriceAmount: 50_000n,
            quantity,
            lineTotalAmount: 50_000n * BigInt(quantity),
            currency: 'VND',
          },
        },
      },
    });
    subOrders.push({ subOrder, vendor, wallet, variant, paid: paidOf(s) });
  }

  const payment =
    spec.payment === null
      ? null
      : await prisma.payment.create({
          data: {
            id: ulid(),
            orderId: order.id,
            provider: spec.payment?.provider ?? 'VNPAY',
            status: spec.payment?.status ?? 'PENDING',
            amount: spec.payment?.amount ?? grandTotal,
            currency: 'VND',
            providerTxnId: spec.payment?.providerTxnId ?? null,
            providerRef: spec.payment?.providerRef ?? null,
          },
        });

  return { customer, order, subOrders, payment };
}

/** Sets `sub_orders.<column>` to the DB clock + `seconds` (negative = past). */
export async function setSubOrderTime(
  subOrderId: string,
  column: 'delivered_at' | 'completed_at',
  seconds: number,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE sub_orders SET ${column} = (now() AT TIME ZONE 'UTC') + make_interval(secs => $1::float8)
     WHERE id = $2`,
    seconds,
    subOrderId,
  );
}

export const DAY = 86_400;

export function ledgerOf(where: { orderId?: string; subOrderId?: string } = {}) {
  return prisma.ledgerEntry.findMany({ where, orderBy: { id: 'asc' } });
}

/** Every txn group sums to zero (double entry). */
export function groupSums(entries: { txnGroupId: string; amount: bigint }[]): bigint[] {
  const sums = new Map<string, bigint>();
  for (const e of entries) sums.set(e.txnGroupId, (sums.get(e.txnGroupId) ?? 0n) + e.amount);
  return [...sums.values()];
}

export function outboxOf(eventType: string) {
  return prisma.outboxEvent.findMany({ where: { eventType }, orderBy: { createdAt: 'asc' } });
}
