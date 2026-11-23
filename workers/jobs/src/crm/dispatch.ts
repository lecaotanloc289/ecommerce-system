import {
  containsLink,
  deriveUnsubscribeToken,
  DomainError,
  renderCrmTemplate,
  type CrmAutomationKind,
  type CrmSkipReason,
} from '@repo/core';
import { createTranslator, fromCoreLocale, type AppLocale, type MessageKey } from '@repo/i18n';
import { ulid } from 'ulid';
import { renderCrmEmail, type CrmEmailAction } from '../email/crm-templates';
import type { EmailMessage, Mailer } from '../email/mailer';
import { PermanentError } from '../outbox/errors';
import type { Tx } from '../outbox/handler';
import { ensurePreference, hasMarketingConsent, validCrmCouponCode } from './consent';

export interface CrmDispatchDeps {
  mailer: Mailer;
  /** Storefront origin: shop / order / unsubscribe page links. */
  webOrigin: string;
  /** Public API origin: RFC 8058 one-click unsubscribe target. */
  apiPublicUrl: string;
  /** `CRM_UNSUBSCRIBE_SECRET` (same value as the API). */
  unsubscribeSecret: string;
  /**
   * `CRM_EMAIL_ENABLED`: false (default) = in-app only. Turn on once the storefront
   * `/{locale}/unsubscribe` page linked from every CRM email exists.
   */
  emailEnabled: boolean;
}

export type DispatchOutcome =
  /**
   * Committed as SENT (+ the notification). `email` is NOT sent yet: the caller sends it after the
   * commit and calls `revertSent` if that fails.
   */
  | { outcome: 'sent'; notificationId: string | null; email: EmailMessage | null }
  | { outcome: 'skipped'; reason: CrmSkipReason }
  /** Not SCHEDULED / not due any more, or locked by another worker: nothing done. */
  | { outcome: 'gone' };

const WEEK_MS = 7 * 86_400_000;
/**
 * A message still unsent this long after its `scheduledFor` is skipped as STALE: a worker outage, a
 * backlog of old events or an automation enabled late must never send old "thank you" / reminders.
 * (A failed send moves `scheduledFor` forward, so retries are not stale.)
 */
export const CRM_STALE_AFTER_DAYS = 3;
const PLACEHOLDER_COUPON = '{couponCode}';

const DEFAULT_TEMPLATE: Record<CrmAutomationKind, MessageKey> = {
  THANK_YOU: 'crm.defaultTemplates.thankYou',
  REVIEW_REQUEST: 'crm.defaultTemplates.reviewRequest',
  REORDER_REMINDER: 'crm.defaultTemplates.reorderReminder',
};
const AUTOMATION_TITLE: Record<CrmAutomationKind, MessageKey> = {
  THANK_YOU: 'crm.notificationTitle.thankYou',
  REVIEW_REQUEST: 'crm.notificationTitle.reviewRequest',
  REORDER_REMINDER: 'crm.notificationTitle.reorderReminder',
};

/** Sub-order statuses an automation message may still be sent for (refunded / cancelled → skip). */
const LIVE_SUB_ORDER = new Set(['DELIVERED', 'COMPLETED']);

/**
 * Decides and records one due CRM message (C5/C8/C9/C11) inside `tx`, re-checking everything at
 * send time:
 *
 * 1. Lock the row `FOR UPDATE SKIP LOCKED` while it is SCHEDULED and due (DB clock) — no row = sent
 *    / skipped / cancelled meanwhile or another worker has it → `gone`, nothing written.
 * 2. Not more than `CRM_STALE_AFTER_DAYS` past `scheduledFor` (`STALE`); vendor ACTIVE
 *    (`VENDOR_INACTIVE`); campaign still SENDING (`CAMPAIGN_CANCELLED`) or automation
 *    still enabled (`AUTOMATION_DISABLED`) and its sub-order still DELIVERED / COMPLETED
 *    (`ORDER_REFUNDED`).
 * 3. Preference row created if missing and LOCKED (same lock as consent writes / other sends):
 *    SERVICE needs no service opt-out (`OPTED_OUT`); MARKETING needs marketing consent (`OPTED_OUT`
 *    after an opt-out, else `NO_CONSENT`).
 * 4. REVIEW_REQUEST: every product of the sub-order already reviewed by the customer
 *    (`ALREADY_REVIEWED`); REORDER_REMINDER: a newer valid sub-order at this shop
 *    (`ALREADY_REORDERED`); MARKETING: ≥ `crmMaxMarketingPerCustomerPerWeek` marketing messages
 *    SENT to this customer by this shop in the last 7 days (`FREQUENCY_CAP`).
 * 5. Coupon (campaign's, or the REORDER_REMINDER automation's) still valid now; a template needing
 *    `{couponCode}` without one → `COUPON_INVALID`; an invalid coupon on a template that does not
 *    need it is just left out.
 * 6. Channels: IN_APP always (a `notifications` row), EMAIL when enabled (`emailEnabled`) and the
 *    user has an address (`NO_CHANNEL` if neither remains).
 *
 * Then the message is SENT (+ `sentAt`, `notificationId`, `attempts + 1`) and the rendered email is
 * returned, NOT sent: the caller commits first (releasing the message and preference locks, so a
 * slow SMTP server never blocks the customer's unsubscribe or holds the transaction open), then
 * sends, and on failure calls `revertSent`. A crash between commit and send loses that email (the
 * in-app notification stays) — never a duplicate. Text is rendered in the customer's
 * `primaryLocale` (en falls back to the vi template; empty automation templates use the platform
 * default from `@repo/i18n`). A customer name that looks like a link is replaced by
 * `crm.customerFallbackName` (names come from OAuth providers and must not smuggle links into
 * platform mail). A shop name that looks like a link makes the render throw → `PermanentError`
 * (the caller marks the message FAILED at once; retrying cannot help).
 */
export async function dispatchMessage(
  tx: Tx,
  messageId: string,
  deps: CrmDispatchDeps,
): Promise<DispatchOutcome> {
  const [locked] = await tx.$queryRaw<{ dbNow: Date; stale: boolean }[]>`
    SELECT (now() AT TIME ZONE 'UTC') AS "dbNow",
           scheduled_for < (now() AT TIME ZONE 'UTC')
             - make_interval(days => ${CRM_STALE_AFTER_DAYS}::int) AS stale
    FROM crm_messages
    WHERE id = ${messageId} AND status = 'SCHEDULED'
      AND scheduled_for <= (now() AT TIME ZONE 'UTC')
    FOR UPDATE SKIP LOCKED`;
  if (!locked) return { outcome: 'gone' };
  const now = locked.dbNow;

  const message = await tx.crmMessage.findUniqueOrThrow({
    where: { id: messageId },
    select: {
      vendorId: true,
      userId: true,
      kind: true,
      automationKind: true,
      subOrderId: true,
      channels: true,
      vendor: { select: { status: true, displayName: true, slug: true } },
      user: { select: { name: true, email: true, primaryLocale: true } },
      campaign: {
        select: { status: true, templateVi: true, templateEn: true, couponId: true },
      },
      subOrder: { select: { status: true, orderId: true } },
    },
  });
  const skip = async (reason: CrmSkipReason): Promise<DispatchOutcome> => {
    await tx.crmMessage.update({
      where: { id: messageId },
      data: { status: 'SKIPPED', skipReason: reason },
    });
    return { outcome: 'skipped', reason };
  };

  if (locked.stale) return skip('STALE');
  if (message.vendor.status !== 'ACTIVE') return skip('VENDOR_INACTIVE');

  // Source: a campaign or an automation (the DB CHECK guarantees exactly one).
  let templateVi: string | null;
  let templateEn: string | null;
  let couponId: string | null;
  const automationKind = message.automationKind;
  if (message.campaign) {
    if (message.campaign.status !== 'SENDING') return skip('CAMPAIGN_CANCELLED');
    ({ templateVi, templateEn, couponId } = message.campaign);
  } else if (automationKind !== null && message.subOrderId !== null && message.subOrder) {
    const automation = await tx.crmAutomation.findUnique({
      where: { vendorId_kind: { vendorId: message.vendorId, kind: automationKind } },
      select: { isEnabled: true, templateVi: true, templateEn: true, couponId: true },
    });
    if (!automation?.isEnabled) return skip('AUTOMATION_DISABLED');
    if (!LIVE_SUB_ORDER.has(message.subOrder.status)) return skip('ORDER_REFUNDED');
    ({ templateVi, templateEn } = automation);
    couponId = automationKind === 'REORDER_REMINDER' ? automation.couponId : null;
  } else {
    throw new Error(`crm message ${messageId} has neither a campaign nor an automation source`);
  }

  const pref = await ensurePreference(tx, message.userId, message.vendorId, deps.unsubscribeSecret);
  if (message.kind === 'SERVICE') {
    if (pref.serviceOptOutAt !== null) return skip('OPTED_OUT');
  } else if (!hasMarketingConsent(pref)) {
    return skip(pref.marketingOptOutAt !== null ? 'OPTED_OUT' : 'NO_CONSENT');
  }

  if (automationKind === 'REVIEW_REQUEST' && message.subOrderId !== null) {
    const [row] = await tx.$queryRaw<{ missing: number }[]>`
      SELECT COUNT(*)::int AS missing
      FROM (SELECT DISTINCT pv.product_id FROM order_items oi
            JOIN product_variants pv ON pv.id = oi.variant_id
            WHERE oi.sub_order_id = ${message.subOrderId}) p
      WHERE NOT EXISTS (
        SELECT 1 FROM reviews r
        WHERE r.author_id = ${message.userId} AND r.sub_order_id = ${message.subOrderId}
          AND r.product_id = p.product_id)`;
    if ((row?.missing ?? 0) === 0) return skip('ALREADY_REVIEWED');
  }
  if (automationKind === 'REORDER_REMINDER' && message.subOrderId !== null) {
    const [row] = await tx.$queryRaw<{ reordered: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM sub_orders so JOIN orders o ON o.id = so.order_id
        WHERE so.vendor_id = ${message.vendorId} AND o.customer_id = ${message.userId}
          AND so.id <> ${message.subOrderId}
          AND so.status IN ('PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED')
          AND so.created_at > (SELECT created_at FROM sub_orders WHERE id = ${message.subOrderId})
      ) AS reordered`;
    if (row?.reordered === true) return skip('ALREADY_REORDERED');
  }
  if (message.kind === 'MARKETING') {
    const settings = await tx.platformSettings.findFirst({
      orderBy: { id: 'asc' },
      select: { crmMaxMarketingPerCustomerPerWeek: true },
    });
    if (!settings) throw new Error('platform settings missing');
    const sentThisWeek = await tx.crmMessage.count({
      where: {
        vendorId: message.vendorId,
        userId: message.userId,
        kind: 'MARKETING',
        status: 'SENT',
        sentAt: { gt: new Date(now.getTime() - WEEK_MS) },
      },
    });
    if (sentThisWeek >= settings.crmMaxMarketingPerCustomerPerWeek) return skip('FREQUENCY_CAP');
  }

  const locale: AppLocale = fromCoreLocale(message.user.primaryLocale);
  const t = createTranslator(locale);
  const template =
    (locale === 'en' ? (templateEn ?? templateVi) : templateVi) ??
    (automationKind !== null ? t(DEFAULT_TEMPLATE[automationKind]) : null);
  if (template === null) throw new Error(`crm message ${messageId} has no template`);

  const couponCode =
    couponId === null ? null : await validCrmCouponCode(tx, message.vendorId, couponId, now);
  const templateNeedsCoupon = template.includes(PLACEHOLDER_COUPON);
  if (templateNeedsCoupon && couponCode === null) return skip('COUPON_INVALID');

  const sendInApp = message.channels.includes('IN_APP');
  const email = deps.emailEnabled && message.channels.includes('EMAIL') ? message.user.email : null;
  if (!sendInApp && email === null) return skip('NO_CHANNEL');

  const shopName = message.vendor.displayName;
  const customerName = containsLink(message.user.name)
    ? t('crm.customerFallbackName')
    : message.user.name;
  let body: string;
  try {
    body = renderCrmTemplate(template, {
      customerName,
      shopName,
      couponCode: couponCode ?? undefined,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      throw new PermanentError(`crm message ${messageId} cannot be rendered (${error.code})`);
    }
    throw error;
  }
  const title = t(
    automationKind !== null ? AUTOMATION_TITLE[automationKind] : 'crm.notificationTitle.campaign',
    {
      shopName,
    },
  );
  const shopPath = `/vendors/${message.vendor.slug}`;
  const linkPath =
    automationKind === 'REVIEW_REQUEST' && message.subOrder
      ? `/account/orders/${message.subOrder.orderId}`
      : shopPath;

  let notificationId: string | null = null;
  if (sendInApp) {
    notificationId = ulid();
    await tx.notification.create({
      data: {
        id: notificationId,
        userId: message.userId,
        vendorId: message.vendorId,
        title,
        body,
        linkPath,
        createdAt: now,
      },
    });
  }
  await tx.crmMessage.update({
    where: { id: messageId },
    data: { status: 'SENT', sentAt: now, notificationId, attempts: { increment: 1 } },
  });

  let mail: EmailMessage | null = null;
  if (email !== null) {
    const token = await deriveUnsubscribeToken(
      deps.unsubscribeSecret,
      message.userId,
      message.vendorId,
    );
    const web = (path: string): string => new URL(`/${locale}${path}`, deps.webOrigin).toString();
    const unsubscribePage = (scope: 'MARKETING' | 'ALL'): string => {
      const url = new URL(`/${locale}/unsubscribe`, deps.webOrigin);
      url.searchParams.set('token', token);
      url.searchParams.set('scope', scope);
      return url.toString();
    };
    // One-click (RFC 8058) unsubscribes from this kind of mail: marketing mail → marketing only,
    // service mail → everything from this shop.
    const oneClick = new URL('/v1/crm/unsubscribe/one-click', deps.apiPublicUrl);
    oneClick.searchParams.set('token', token);
    oneClick.searchParams.set('scope', message.kind === 'MARKETING' ? 'MARKETING' : 'ALL');

    const actions: CrmEmailAction[] = [
      ...(automationKind === 'REVIEW_REQUEST'
        ? [{ label: t('crm.email.writeReview'), url: web(linkPath) }]
        : []),
      { label: t('crm.email.viewShop'), url: web(shopPath) },
    ];
    mail = {
      to: email,
      headers: {
        'List-Unsubscribe': `<${oneClick.toString()}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      ...renderCrmEmail({
        locale,
        subject: title,
        body,
        shopName,
        // The code is already in the text when the template uses {couponCode}.
        couponCode: templateNeedsCoupon ? null : couponCode,
        actions,
        unsubscribe: {
          marketing: message.kind === 'MARKETING' ? unsubscribePage('MARKETING') : null,
          all: unsubscribePage('ALL'),
        },
      }),
    };
  }
  return { outcome: 'sent', notificationId, email: mail };
}
