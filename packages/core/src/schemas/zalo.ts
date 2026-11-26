import { z } from 'zod';
import {
  ZaloAccountStatusSchema,
  ZaloMessageEventSchema,
  ZaloMessageStatusSchema,
  type SubOrderStatus,
  type ZaloMessageEvent,
} from '../enums';
import {
  OrderIdSchema,
  SubOrderIdSchema,
  UserIdSchema,
  VendorIdSchema,
  ZaloLoginIdSchema,
  ZaloMessageIdSchema,
} from '../ids';
import { PageQuerySchema, PageSchema } from './common';
import { IsoDateTimeSchema } from './datetime';

// Automated Zalo messages per shop (server `src/zalo/` + `workers/zalo`). A vendor logs a personal
// Zalo account in by QR, writes one template per ZaloMessageEvent, and the worker messages
// opted-in customers (Order.zaloOptIn) when the sub-order changes. Templates are vendor-authored
// content, not platform UI text, so they are not i18n keys.

// ─── Templates ────────────────────────────────────────────────────────────────────────────────

/** Placeholders a template may use, written `{{name}}`. Values are filled by the worker at send time. */
export const ZALO_TEMPLATE_PLACEHOLDERS = [
  'customerName',
  'orderCode',
  'shopName',
  'total',
  'itemList',
  'carrier',
  'trackingNumber',
] as const;
export const ZaloTemplatePlaceholderSchema = z.enum(ZALO_TEMPLATE_PLACEHOLDERS);
export type ZaloTemplatePlaceholder = z.infer<typeof ZaloTemplatePlaceholderSchema>;
export type ZaloTemplateVars = Readonly<Record<ZaloTemplatePlaceholder, string>>;

export const ZALO_TEMPLATE_MAX_LENGTH = 2000;
/** Payload sanity bound for the AFTER_DELIVERY delay (60 days). */
export const ZALO_MAX_DELAY_MINUTES = 60 * 24 * 60;

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const KNOWN_PLACEHOLDERS: ReadonlySet<string> = new Set(ZALO_TEMPLATE_PLACEHOLDERS);

/** First `{{name}}` in `body` that is not a known placeholder, or null when all are known. */
export function findUnknownZaloPlaceholder(body: string): string | null {
  for (const match of body.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1] ?? '';
    if (!KNOWN_PLACEHOLDERS.has(name)) return name;
  }
  return null;
}

/** Replaces every known `{{name}}` with its value; unknown ones are left verbatim (validated on write). */
export function renderZaloTemplate(body: string, vars: ZaloTemplateVars): string {
  return body.replace(PLACEHOLDER_PATTERN, (whole, name: string) => {
    const parsed = ZaloTemplatePlaceholderSchema.safeParse(name);
    return parsed.success ? vars[parsed.data] : whole;
  });
}

/** Customer-facing short order code used in messages: `#` + the last 8 chars of the order ULID. */
export function formatOrderCode(orderId: string): string {
  return `#${orderId.slice(-8)}`;
}

/** The ZaloMessageEvent a sub-order status change triggers (null: no message for that status). */
export const ZALO_STATUS_EVENTS: Readonly<Partial<Record<SubOrderStatus, ZaloMessageEvent>>> = {
  PAID: 'ORDER_PAID',
  PROCESSING: 'ORDER_PROCESSING',
  SHIPPED: 'ORDER_SHIPPED',
  DELIVERED: 'ORDER_DELIVERED',
  COMPLETED: 'ORDER_COMPLETED',
  CANCELLED: 'ORDER_CANCELLED',
  REFUNDED: 'ORDER_REFUNDED',
};

export function zaloEventForSubOrderStatus(status: SubOrderStatus): ZaloMessageEvent | null {
  return ZALO_STATUS_EVENTS[status] ?? null;
}

/** Path params of `PUT /v1/vendor/zalo/templates/:event`. */
export const ZaloTemplateParamsSchema = z.object({ event: ZaloMessageEventSchema });
export type ZaloTemplateParams = z.infer<typeof ZaloTemplateParamsSchema>;

/**
 * Body of `PUT /v1/vendor/zalo/templates/:event`. `delayMinutes` only matters for AFTER_DELIVERY
 * (the server stores 0 for every other event). Unknown placeholders → 422 `zalo.error.unknown-placeholder`.
 */
export const ZaloTemplateUpsertSchema = z.object({
  isEnabled: z.boolean(),
  body: z.string().trim().min(1).max(ZALO_TEMPLATE_MAX_LENGTH),
  delayMinutes: z.number().int().min(0).max(ZALO_MAX_DELAY_MINUTES).default(0),
});
export type ZaloTemplateUpsert = z.infer<typeof ZaloTemplateUpsertSchema>;

/** One event's template. Never configured → `isEnabled: false`, `body: null`, `updatedAt: null`. */
export const ZaloTemplateSchema = z.object({
  event: ZaloMessageEventSchema,
  isEnabled: z.boolean(),
  body: z.string().nullable(),
  delayMinutes: z.number().int().min(0),
  updatedAt: IsoDateTimeSchema.nullable(),
});
export type ZaloTemplate = z.infer<typeof ZaloTemplateSchema>;

/** `GET /v1/vendor/zalo/templates`: every event (enum order) + the placeholders a body may use. */
export const ZaloTemplateListSchema = z.object({
  items: z.array(ZaloTemplateSchema),
  placeholders: z.array(ZaloTemplatePlaceholderSchema),
});
export type ZaloTemplateList = z.infer<typeof ZaloTemplateListSchema>;

// ─── Account + QR login ───────────────────────────────────────────────────────────────────────

/** The shop's connected Zalo account (credentials never leave workers/zalo). */
export const ZaloAccountSchema = z.object({
  status: ZaloAccountStatusSchema,
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  lastLoginAt: IsoDateTimeSchema.nullable(),
  lastSeenAt: IsoDateTimeSchema.nullable(),
});
export type ZaloAccount = z.infer<typeof ZaloAccountSchema>;

export const ZaloAccountResponseSchema = z.object({ account: ZaloAccountSchema.nullable() });
export type ZaloAccountResponse = z.infer<typeof ZaloAccountResponseSchema>;

/** 202 body of `POST /v1/vendor/zalo/login-requests` — poll `GET …/login-requests/:loginId`. */
export const ZaloLoginStartSchema = z.object({ loginId: ZaloLoginIdSchema });
export type ZaloLoginStart = z.infer<typeof ZaloLoginStartSchema>;

export const ZaloLoginParamsSchema = z.object({ loginId: ZaloLoginIdSchema });
export type ZaloLoginParams = z.infer<typeof ZaloLoginParamsSchema>;

export const ZaloLoginFailureReasonSchema = z.enum(['already-linked', 'login-failed']);
export type ZaloLoginFailureReason = z.infer<typeof ZaloLoginFailureReasonSchema>;

/**
 * Progress of one QR login. PENDING (queued) → QR_READY (show `qrImage`, a PNG data URL) →
 * SCANNED (confirm on the phone) → SUCCESS; or EXPIRED / DECLINED / FAILED (start a new request).
 */
export const ZaloLoginStateSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('PENDING') }),
  z.object({ state: z.literal('QR_READY'), qrImage: z.string().startsWith('data:image/') }),
  z.object({
    state: z.literal('SCANNED'),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  z.object({ state: z.literal('SUCCESS'), displayName: z.string() }),
  z.object({ state: z.literal('EXPIRED') }),
  z.object({ state: z.literal('DECLINED') }),
  z.object({ state: z.literal('FAILED'), reason: ZaloLoginFailureReasonSchema }),
]);
export type ZaloLoginState = z.infer<typeof ZaloLoginStateSchema>;

/**
 * Redis contract between the API and workers/zalo. The API writes `zaloLoginKey(id)` =
 * JSON `ZaloLoginRecord` (state PENDING, TTL `ZALO_LOGIN_TTL_SECONDS`) and `LPUSH`es the id onto
 * `ZALO_LOGIN_QUEUE_KEY`; the worker pops it, drives zca-js `loginQR` and overwrites `state`.
 */
export const ZaloLoginRecordSchema = z.object({
  vendorId: VendorIdSchema,
  requestedById: UserIdSchema,
  state: ZaloLoginStateSchema,
});
export type ZaloLoginRecord = z.infer<typeof ZaloLoginRecordSchema>;

export const ZALO_LOGIN_QUEUE_KEY = 'zalo:login:queue';
export const ZALO_LOGIN_TTL_SECONDS = 600;
export function zaloLoginKey(loginId: string): string {
  return `zalo:login:${loginId}`;
}

// ─── Message log ──────────────────────────────────────────────────────────────────────────────

/** Why the worker did not send a message (`ZaloMessage.skipReason`). */
export const ZaloSkipReasonSchema = z.enum([
  'template-disabled',
  'vendor-inactive',
  'invalid-phone',
  'recipient-not-found',
  'account-unavailable',
  'order-status-changed',
]);
export type ZaloSkipReason = z.infer<typeof ZaloSkipReasonSchema>;

export const ZaloMessageSchema = z.object({
  id: ZaloMessageIdSchema,
  orderId: OrderIdSchema,
  subOrderId: SubOrderIdSchema,
  event: ZaloMessageEventSchema,
  status: ZaloMessageStatusSchema,
  scheduledAt: IsoDateTimeSchema,
  sentAt: IsoDateTimeSchema.nullable(),
  attempts: z.number().int().min(0),
  skipReason: ZaloSkipReasonSchema.nullable(),
  renderedBody: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type ZaloMessage = z.infer<typeof ZaloMessageSchema>;

/** `GET /v1/vendor/zalo/messages?status=&cursor=&limit=` (newest first). */
export const ZaloMessageListQuerySchema = PageQuerySchema.extend({
  status: ZaloMessageStatusSchema.optional(),
});
export type ZaloMessageListQuery = z.infer<typeof ZaloMessageListQuerySchema>;

export const ZaloMessagePageSchema = PageSchema(ZaloMessageSchema);
export type ZaloMessagePage = z.infer<typeof ZaloMessagePageSchema>;
