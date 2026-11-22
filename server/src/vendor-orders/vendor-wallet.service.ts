import { Injectable } from '@nestjs/common';
import {
  DomainError,
  type LedgerEntryPage,
  LedgerEntryPageSchema,
  Money,
  type PageQuery,
  type SubOrderStatus,
  type VendorWallet,
  VendorWalletSchema,
} from '@repo/core';
import { toMoney } from '@repo/db';
import { cursorPageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

/** Paid, not refunded: the sub-orders whose net will reach the wallet once the payout is released. */
export const PENDING_PAYOUT_STATUSES: readonly SubOrderStatus[] = [
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'COMPLETED',
];

/**
 * Vendor wallet + ledger (T3.3), `VENDOR_OWNER` only. Staff are refused by `@Roles`, and the owner
 * role on THIS vendor is re-checked in the DB (a user can own one vendor and be staff of another).
 */
@Injectable()
export class VendorWalletService {
  constructor(private readonly prisma: PrismaService) {}

  async wallet(userId: string, vendorId: string): Promise<VendorWallet> {
    await this.assertOwner(userId, vendorId);
    const wallet = await this.prisma.client.wallet.findUnique({ where: { vendorId } });
    if (!wallet) throw new DomainError('common.error.not-found');

    const groups = await this.prisma.client.subOrder.groupBy({
      by: ['currency'],
      where: { vendorId, status: { in: [...PENDING_PAYOUT_STATUSES] }, payoutReleasedAt: null },
      _sum: {
        subtotalAmount: true,
        shippingAmount: true,
        discountAmount: true,
        commissionAmount: true,
      },
    });
    // Alphabetical by code (Postgres would order the enum by declaration order).
    groups.sort((a, b) => a.currency.localeCompare(b.currency));
    const pending = groups.map(({ currency, _sum: s }) => {
      const money = (amount: bigint | null) => toMoney(amount ?? 0n, currency);
      // Σ net_i (D7) = Σ subtotal + Σ shipping − Σ vendorDiscount − Σ commission
      return Money.subtract(
        Money.subtract(
          Money.add(money(s.subtotalAmount), money(s.shippingAmount)),
          money(s.discountAmount),
        ),
        money(s.commissionAmount),
      );
    });

    return VendorWalletSchema.parse({
      id: wallet.id,
      vendorId: wallet.vendorId,
      balance: toMoney(wallet.balanceAmount, wallet.balanceCurrency),
      pending,
    });
  }

  /** The vendor's own VENDOR_WALLET ledger lines, newest first (escrow/revenue lines never leave). */
  async ledger(userId: string, vendorId: string, query: PageQuery): Promise<LedgerEntryPage> {
    await this.assertOwner(userId, vendorId);
    const args = cursorPageArgs(query, 'desc');
    const rows = await this.prisma.client.ledgerEntry.findMany({
      ...args,
      where: { account: 'VENDOR_WALLET', vendorId, ...args.where },
    });
    const page = toPage(rows, query);
    return LedgerEntryPageSchema.parse({
      items: page.items.map((row) => ({
        id: row.id,
        txnGroupId: row.txnGroupId,
        account: row.account,
        entryType: row.entryType,
        amount: toMoney(row.amount, row.currency),
        orderId: row.orderId,
        subOrderId: row.subOrderId,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    });
  }

  private async assertOwner(userId: string, vendorId: string): Promise<void> {
    const count = await this.prisma.client.userRole.count({
      where: { userId, vendorId, role: 'VENDOR_OWNER' },
    });
    if (count === 0) throw new DomainError('common.error.forbidden');
  }
}
