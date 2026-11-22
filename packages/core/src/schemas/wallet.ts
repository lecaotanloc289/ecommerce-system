import { z } from 'zod';
import { LedgerAccountSchema, LedgerEntryTypeSchema } from '../enums';
import {
  LedgerEntryIdSchema,
  OrderIdSchema,
  SubOrderIdSchema,
  UlidSchema,
  VendorIdSchema,
  WalletIdSchema,
} from '../ids';
import { PageSchema } from './common';
import { IsoDateTimeSchema } from './datetime';
import { MoneySchema, NonNegativeMoneySchema } from './money';

/** Vendor wallet: balance of funds already released from escrow. */
export const WalletSchema = z.object({
  id: WalletIdSchema,
  vendorId: VendorIdSchema,
  balance: NonNegativeMoneySchema,
});
export type Wallet = z.infer<typeof WalletSchema>;

/**
 * Ledger line (read-only), platform-staff view. Vendor endpoints must filter to the vendor's own
 * VENDOR_WALLET entries server-side (never expose escrow/revenue lines to vendors).
 * Ledger line (read-only). `amount` is signed: negative debits the account, positive credits it. */
export const LedgerEntrySchema = z.object({
  id: LedgerEntryIdSchema,
  txnGroupId: UlidSchema,
  account: LedgerAccountSchema,
  entryType: LedgerEntryTypeSchema,
  amount: MoneySchema,
  orderId: OrderIdSchema.nullable(),
  subOrderId: SubOrderIdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

/** Page of `GET /v1/vendor/ledger` (the vendor's own VENDOR_WALLET lines only, newest first). */
export const LedgerEntryPageSchema = PageSchema(LedgerEntrySchema);
export type LedgerEntryPage = z.infer<typeof LedgerEntryPageSchema>;

/**
 * `GET /v1/vendor/wallet`: released `balance` + `pending` = Σ net (subtotal + shipping −
 * vendorDiscount − commission) of the vendor's sub-orders in PAID..COMPLETED whose payout is not
 * released yet, one entry per currency (sorted by currency; empty when nothing is pending).
 */
export const VendorWalletSchema = WalletSchema.extend({
  pending: z.array(NonNegativeMoneySchema),
});
export type VendorWallet = z.infer<typeof VendorWalletSchema>;
