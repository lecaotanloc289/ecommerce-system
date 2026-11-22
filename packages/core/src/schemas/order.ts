import { z } from 'zod';
import { OrderStatusSchema, PaymentStatusSchema, SubOrderStatusSchema } from '../enums';
import {
  OrderIdSchema,
  OrderItemIdSchema,
  ProductIdSchema,
  ProductVariantIdSchema,
  SubOrderIdSchema,
  VendorIdSchema,
} from '../ids';
import { AddressSchema } from './address';
import { HttpUrlSchema } from './common';
import { IsoDateTimeSchema } from './datetime';
import { NonNegativeMoneySchema } from './money';
import { VariantAttributesSchema } from './product';

/** Line of a sub-order. Title, attributes and price are the checkout-time snapshot. */
export const OrderItemSchema = z.object({
  id: OrderItemIdSchema,
  variantId: ProductVariantIdSchema,
  /** Lets clients link back to the product and file a review (`ReviewCreate.productId`). */
  productId: ProductIdSchema,
  productTitle: z.string().min(1),
  attributes: VariantAttributesSchema,
  unitPrice: NonNegativeMoneySchema,
  quantity: z.number().int().min(1),
  lineTotal: NonNegativeMoneySchema,
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

/** Address copied into the sub-order at checkout (`SubOrder.shippingAddress`); later edits never touch it. */
export const ShippingAddressSnapshotSchema = AddressSchema.omit({ id: true, isDefault: true });
export type ShippingAddressSnapshot = z.infer<typeof ShippingAddressSnapshotSchema>;

/**
 * One vendor's part of an order, as the customer sees it (no commission).
 * `total` = subtotal + shipping − vendorDiscount − platformDiscount (what this sub-order is paid with).
 */
export const SubOrderSchema = z.object({
  id: SubOrderIdSchema,
  orderId: OrderIdSchema,
  vendorId: VendorIdSchema,
  vendorName: z.string().min(1),
  status: SubOrderStatusSchema,
  items: z.array(OrderItemSchema),
  subtotal: NonNegativeMoneySchema,
  shipping: NonNegativeMoneySchema,
  vendorDiscount: NonNegativeMoneySchema,
  platformDiscount: NonNegativeMoneySchema,
  total: NonNegativeMoneySchema,
  shippingMethodName: z.string().nullable(),
  shippingAddress: ShippingAddressSnapshotSchema,
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  shippedAt: IsoDateTimeSchema.nullable(),
  deliveredAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  cancelledAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type SubOrder = z.infer<typeof SubOrderSchema>;

/** Sub-order as the owning vendor sees it: adds the commission snapshot and net payout. */
export const VendorSubOrderSchema = SubOrderSchema.extend({
  commission: NonNegativeMoneySchema,
  net: NonNegativeMoneySchema,
});
export type VendorSubOrder = z.infer<typeof VendorSubOrderSchema>;

/** Order aggregate root (customer-facing). `status` is derived from the sub-orders. */
export const OrderSchema = z.object({
  id: OrderIdSchema,
  status: OrderStatusSchema,
  itemsTotal: NonNegativeMoneySchema,
  shippingTotal: NonNegativeMoneySchema,
  discountTotal: NonNegativeMoneySchema,
  grandTotal: NonNegativeMoneySchema,
  paymentDeadlineAt: IsoDateTimeSchema.nullable(),
  subOrders: z.array(SubOrderSchema),
  createdAt: IsoDateTimeSchema,
});
export type Order = z.infer<typeof OrderSchema>;

/** Row of the order history list (`GET /v1/orders`). */
export const OrderSummarySchema = z.object({
  id: OrderIdSchema,
  status: OrderStatusSchema,
  grandTotal: NonNegativeMoneySchema,
  itemCount: z.number().int().nonnegative(),
  subOrderCount: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
});
export type OrderSummary = z.infer<typeof OrderSummarySchema>;

/**
 * Response of `GET /v1/orders/:id/payment`. The worker creates the provider session
 * asynchronously, so `redirectUrl` is null until it is ready (clients poll).
 */
export const PaymentSessionSchema = z.object({
  status: PaymentStatusSchema,
  redirectUrl: HttpUrlSchema.nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
});
export type PaymentSession = z.infer<typeof PaymentSessionSchema>;

/** Body of `POST /v1/vendor/sub-orders/:id/ship`. */
export const SubOrderShipSchema = z.object({
  carrier: z.string().trim().min(1).max(80),
  trackingNumber: z.string().trim().min(1).max(80),
});
export type SubOrderShip = z.infer<typeof SubOrderShipSchema>;
