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
