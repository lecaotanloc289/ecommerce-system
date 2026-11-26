import type { CrmAutomationKind, CrmMessageKind } from '../enums';
import { DomainError } from '../errors';
import type { CrmSkipReason, CustomerSegment } from '../schemas/crm';

// Pure vendor-CRM logic (decisions C3, C7, C8 in docs/superpowers/plans/2026-11-23-vendor-crm.md).
// Type-only imports from ../schemas/crm: the schema module imports `assertCrmTemplate` from here.

const MS_PER_DAY = 86_400_000;

/** `PlatformSettings` thresholds for `classifyCustomer`. */
export interface CustomerSegmentThresholds {
  /** Days since the last valid order after which a customer is AT_RISK (default 60). */
  readonly atRiskAfterDays: number;
  /** Days since the last valid order after which a customer is LAPSED (default 180). */
  readonly lapsedAfterDays: number;
  /** Valid orders needed for VIP (default 3). */
  readonly vipMinOrders: number;
}

/**
 * Customer segment from valid-order stats (C3). Precedence: LAPSED (> lapsedAfterDays since the
 * last order) → AT_RISK (> atRiskAfterDays) → VIP (orderCount ≥ vipMinOrders) → RETURNING
 * (≥ 2) → NEW. Boundaries are strict: exactly 60 days ago is not yet AT_RISK.
 */
export function classifyCustomer(
  stats: { readonly orderCount: number; readonly lastOrderAt: Date | string },
  now: Date,
  thresholds: CustomerSegmentThresholds,
): CustomerSegment {
  const lastOrderMs = new Date(stats.lastOrderAt).getTime();
  if (Number.isNaN(lastOrderMs) || thresholds.atRiskAfterDays >= thresholds.lapsedAfterDays) {
    throw new DomainError('common.error.internal', { reason: 'invalid-segment-input' });
  }
  const elapsedMs = now.getTime() - lastOrderMs;
  if (elapsedMs > thresholds.lapsedAfterDays * MS_PER_DAY) return 'LAPSED';
  if (elapsedMs > thresholds.atRiskAfterDays * MS_PER_DAY) return 'AT_RISK';
  if (stats.orderCount >= thresholds.vipMinOrders) return 'VIP';
  if (stats.orderCount >= 2) return 'RETURNING';
  return 'NEW';
}

export const CRM_TEMPLATE_PLACEHOLDERS = ['customerName', 'shopName', 'couponCode'] as const;
export type CrmTemplatePlaceholder = (typeof CRM_TEMPLATE_PLACEHOLDERS)[number];

const PLACEHOLDER_REGEX = /\{([^{}]*)\}/g;

const isPlaceholder = (name: string): name is CrmTemplatePlaceholder =>
  CRM_TEMPLATE_PLACEHOLDERS.some((p) => p === name);

// Closed TLD list for bare `domain.tld` detection (keeps decimals and ordinary sentences safe).
const TLD_LIST =
  'com|net|org|vn|io|co|me|shop|store|xyz|info|biz|app|dev|online|site|link|ly|top|club|vip|asia|edu|gov|page|click|id|us|uk|jp|kr|cn|tv|be|gy|at|ee|gl|gd|watch|bio|ru|in|to|cc|gg|ai|sg|th|ws';
// The TLD must be all-lowercase or all-UPPERCASE: "ngay.Top" / "Order.Shop now" are prose, "bit.ly" / "SHOP.VN" are links.
const TLD_GROUP = `(?:${TLD_LIST}|${TLD_LIST.toUpperCase()})`;
const LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?';
const BARE_DOMAIN_REGEX = new RegExp(
  `(?<![\\p{L}\\p{N}-])${LABEL}(?:\\.${LABEL})*\\.${TLD_GROUP}(?![\\p{L}\\p{N}])`,
  'u',
);
const LINK_PATTERNS: readonly RegExp[] = [
  /[a-z][a-z0-9+.-]*:\/\//i, // any scheme://
  /(?<![:\p{L}\p{N}/])\/\/[\p{L}\p{N}]/u, // bare //host
  /(?<![\p{L}\p{N}])(?:tg|zalo|intent|mailto):(?=\S)/iu,
  /(?<![\p{L}\p{N}])www\./iu,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/, // IPv4
  BARE_DOMAIN_REGEX, // also catches e-mail addresses (a@b.com): emails count as links
];

/** Fold look-alikes first: NFKC (full-width), drop format chars (zero-width), ideographic dots → ".". */
function foldForLinkScan(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[。．｡]/g, '.');
}

/** First link-like substring of the text (after folding), or null. (C7: shops may not post links.) */
export function findLink(text: string): string | null {
  const folded = foldForLinkScan(text);
  for (const pattern of LINK_PATTERNS) {
    const match = pattern.exec(folded);
    if (match) return match[0];
  }
  return null;
}

export function containsLink(text: string): boolean {
  return findLink(text) !== null;
}

/**
 * Validates shop-authored CRM text (C7): only `{customerName}` `{shopName}` `{couponCode}`
 * placeholders, and no links. Throws `crm.error.unknown-placeholder` / `crm.error.links-not-allowed`.
 */
export function assertCrmTemplate(text: string): void {
  for (const match of text.matchAll(PLACEHOLDER_REGEX)) {
    const name = match[1] ?? '';
    if (!isPlaceholder(name)) {
      throw new DomainError('crm.error.unknown-placeholder', { placeholder: name });
    }
  }
  // Neutralise valid placeholders so "{shopName}.com" still reads as a domain.
  const match = findLink(text.replace(PLACEHOLDER_REGEX, 'x'));
  if (match !== null) throw new DomainError('crm.error.links-not-allowed', { match });
}

export interface CrmTemplateValues {
  readonly customerName: string;
  readonly shopName: string;
  /** Absent → `{couponCode}` renders as an empty string. */
  readonly couponCode?: string | undefined;
}

/** Plain-text render (throws `crm.error.links-not-allowed` if shopName / couponCode carry a link): substitutes placeholders in one pass (values are never re-scanned). */
export function renderCrmTemplate(text: string, values: CrmTemplateValues): string {
  // customerName is the recipient's own name (not shop-authored) so it is not scanned.
  for (const value of [values.shopName, values.couponCode ?? '']) {
    const match = findLink(value);
    if (match !== null) throw new DomainError('crm.error.links-not-allowed', { match });
  }
  return text.replace(PLACEHOLDER_REGEX, (whole, name: string) => {
    switch (name) {
      case 'customerName':
        return values.customerName;
      case 'shopName':
        return values.shopName;
      case 'couponCode':
        return values.couponCode ?? '';
      default:
        return whole;
    }
  });
}

/** SERVICE vs MARKETING per automation (C8). */
export function messageKindOf(kind: CrmAutomationKind): CrmMessageKind {
  return kind === 'REORDER_REMINDER' ? 'MARKETING' : 'SERVICE';
}

export const CRM_COUPON_CODE_REGEX = /^[A-Z0-9_-]{3,32}$/;

/** Coupon code as shown to customers: strict charset so it cannot smuggle a link into a message. */
export function assertCrmCouponCode(code: string): void {
  if (!CRM_COUPON_CODE_REGEX.test(code)) throw new DomainError('crm.error.coupon-invalid');
}

// --- Unsubscribe tokens (deterministic, WebCrypto only: core stays browser/Node-safe) ----------

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url (no padding, 43 chars) of HMAC-SHA256(secret, `${userId}:${vendorId}`). */
export async function deriveUnsubscribeToken(
  secret: string,
  userId: string,
  vendorId: string,
): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await subtle.sign('HMAC', key, encoder.encode(`${userId}:${vendorId}`));
  return toBase64Url(new Uint8Array(mac));
}

/** sha256 hex of the token (only the hash is stored in the DB). */
export async function hashUnsubscribeToken(token: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type { CrmSkipReason };
