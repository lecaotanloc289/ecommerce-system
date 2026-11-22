import { createHash, timingSafeEqual } from 'node:crypto';
import { Money, OUTBOX_EVENT_SCHEMAS } from '@repo/core';
import { toMoney } from '@repo/db';
import { DEFAULT_LOCALE, fromCoreLocale, type AppLocale } from '@repo/i18n';
import type { EmailContent, Mailer } from '../email/mailer';
import {
  orderUrl,
  renderOrderCancelled,
  renderOrderCreated,
  renderOrderPaid,
  renderPayoutReleased,
  renderSubOrderShipped,
  renderVendorApplicationApproved,
  renderVendorApplicationRejected,
  renderVendorInvitation,
} from '../email/templates';
import { PermanentError } from '../outbox/errors';
import { defineHandler, type HandlerContext, type OutboxHandler } from '../outbox/handler';

export interface EmailDeps {
  mailer: Mailer;
  /** Storefront origin (order links). */
  webOrigin: string;
  /** Admin / vendor portal origin. */
  adminOrigin: string;
}

interface RenderInput {
  locale: AppLocale;
  name: string;
}

/**
 * Renders in the recipient's `primaryLocale` and sends. A user without an email (Facebook-only
 * sign-in) is skipped: the event is still marked processed. Idempotency: a redelivered event
 * (crash after sending, before commit) sends the email again — accepted at-least-once.
 */
async function sendToUser(
  deps: EmailDeps,
  ctx: HandlerContext,
  userId: string,
  render: (recipient: RenderInput) => EmailContent,
): Promise<void> {
  const user = await ctx.tx.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, primaryLocale: true },
  });
  if (!user) throw new PermanentError(`email recipient ${userId} not found`);
  if (!user.email) {
    ctx.log.info({ userId }, 'recipient has no email address; email skipped');
    return;
  }
  const content = render({ locale: fromCoreLocale(user.primaryLocale), name: user.name });
  await deps.mailer.send({ to: user.email, ...content });
  ctx.log.info({ userId }, 'email sent');
}

async function loadOrder(ctx: HandlerContext, orderId: string) {
  const order = await ctx.tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      customerId: true,
      status: true,
      currency: true,
      grandTotalAmount: true,
      paymentDeadlineAt: true,
    },
  });
  if (!order) throw new PermanentError(`order ${orderId} not found`);
  return order;
}

/** The sub-order, checked against the ids the event names. */
async function loadSubOrder(
  ctx: HandlerContext,
  subOrderId: string,
  expect: { orderId?: string; vendorId?: string },
) {
  const subOrder = await ctx.tx.subOrder.findUnique({
    where: { id: subOrderId },
    select: {
      orderId: true,
      vendorId: true,
      currency: true,
      subtotalAmount: true,
      shippingAmount: true,
      discountAmount: true,
      commissionAmount: true,
      carrier: true,
      trackingNumber: true,
      order: { select: { customerId: true } },
      vendor: { select: { displayName: true, ownerId: true } },
    },
  });
  if (
    !subOrder ||
    (expect.orderId !== undefined && subOrder.orderId !== expect.orderId) ||
    (expect.vendorId !== undefined && subOrder.vendorId !== expect.vendorId)
  ) {
    throw new PermanentError(`sub-order ${subOrderId} not found`);
  }
  return subOrder;
}

/** True when `token` hashes (sha256 hex, as the API stores it) to `tokenHash`. */
function tokenMatches(token: string, tokenHash: string): boolean {
  const actual = createHash('sha256').update(token).digest();
  const expected = Buffer.from(tokenHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

/** Email handlers by event type. Recipients and data are always re-read from the DB. */
export function emailHandlers(deps: EmailDeps) {
  const portalUrl = new URL('/', deps.adminOrigin).toString();

  return {
    'order.created': defineHandler(OUTBOX_EVENT_SCHEMAS['order.created'], async (event, ctx) => {
      const order = await loadOrder(ctx, event.orderId);
      // Paid or cancelled before we got here: the "please pay" mail would be wrong; the
      // order.paid / order.cancelled mail covers it.
      if (order.status !== 'AWAITING_PAYMENT') {
        ctx.log.info(
          { orderId: order.id, status: order.status },
          'order no longer awaiting payment; email skipped',
        );
        return;
      }
      await sendToUser(deps, ctx, order.customerId, (r) =>
        renderOrderCreated({
          ...r,
          orderId: order.id,
          total: toMoney(order.grandTotalAmount, order.currency),
          paymentDeadlineAt: order.paymentDeadlineAt,
          url: orderUrl(deps.webOrigin, r.locale, order.id),
        }),
      );
    }),

    'order.paid': defineHandler(OUTBOX_EVENT_SCHEMAS['order.paid'], async (event, ctx) => {
      const order = await loadOrder(ctx, event.orderId);
      await sendToUser(deps, ctx, order.customerId, (r) =>
        renderOrderPaid({
          ...r,
          orderId: order.id,
          total: toMoney(order.grandTotalAmount, order.currency),
          url: orderUrl(deps.webOrigin, r.locale, order.id),
        }),
      );
    }),

    'order.cancelled': defineHandler(
      OUTBOX_EVENT_SCHEMAS['order.cancelled'],
      async (event, ctx) => {
        const order = await loadOrder(ctx, event.orderId);
        await sendToUser(deps, ctx, order.customerId, (r) =>
          renderOrderCancelled({
            ...r,
            orderId: order.id,
            reason: event.reason,
            url: orderUrl(deps.webOrigin, r.locale, order.id),
          }),
        );
      },
    ),

    'sub-order.shipped': defineHandler(
      OUTBOX_EVENT_SCHEMAS['sub-order.shipped'],
      async (event, ctx) => {
        const subOrder = await loadSubOrder(ctx, event.subOrderId, { orderId: event.orderId });
        await sendToUser(deps, ctx, subOrder.order.customerId, (r) =>
          renderSubOrderShipped({
            ...r,
            orderId: event.orderId,
            vendorName: subOrder.vendor.displayName,
            carrier: subOrder.carrier,
            trackingNumber: subOrder.trackingNumber,
            url: orderUrl(deps.webOrigin, r.locale, event.orderId),
          }),
        );
      },
    ),

    'payout.released': defineHandler(
      OUTBOX_EVENT_SCHEMAS['payout.released'],
      async (event, ctx) => {
        const subOrder = await loadSubOrder(ctx, event.subOrderId, { vendorId: event.vendorId });
        const m = (amount: bigint) => toMoney(amount, subOrder.currency);
        // D7: net = subtotal + shipping − vendor discount − commission.
        const net = Money.subtract(
          Money.add(m(subOrder.subtotalAmount), m(subOrder.shippingAmount)),
          Money.add(m(subOrder.discountAmount), m(subOrder.commissionAmount)),
        );
        await sendToUser(deps, ctx, subOrder.vendor.ownerId, (r) =>
          renderPayoutReleased({
            ...r,
            orderId: subOrder.orderId,
            vendorName: subOrder.vendor.displayName,
            amount: net,
            portalUrl,
          }),
        );
      },
    ),

    'vendor.application.approved': defineHandler(
      OUTBOX_EVENT_SCHEMAS['vendor.application.approved'],
      async (event, ctx) => {
        await sendToUser(deps, ctx, event.userId, (r) =>
          renderVendorApplicationApproved({ ...r, portalUrl }),
        );
      },
    ),

    'vendor.application.rejected': defineHandler(
      OUTBOX_EVENT_SCHEMAS['vendor.application.rejected'],
      async (event, ctx) => {
        const application = await ctx.tx.vendorApplication.findUnique({
          where: { id: event.applicationId },
          select: { applicantId: true, rejectReason: true },
        });
        if (!application || application.applicantId !== event.userId) {
          throw new PermanentError(`vendor application ${event.applicationId} not found`);
        }
        await sendToUser(deps, ctx, application.applicantId, (r) =>
          renderVendorApplicationRejected({ ...r, reason: application.rejectReason }),
        );
      },
    ),

    /**
     * Staff invitation (T3.7). The only payload with a secret: the raw `token` for the accept
     * link. `secretKeys` makes the dispatcher strip it from the row once processed or
     * dead-lettered; it is never logged. The invitee may have no account yet: their locale is
     * the matching user's, else the default.
     */
    'vendor.invitation.created': defineHandler(
      OUTBOX_EVENT_SCHEMAS['vendor.invitation.created'],
      async (event, ctx) => {
        const invitation = await ctx.tx.vendorInvitation.findUnique({
          where: { id: event.invitationId },
          select: {
            vendorId: true,
            email: true,
            tokenHash: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            vendor: { select: { displayName: true } },
          },
        });
        if (!invitation || invitation.vendorId !== event.vendorId) {
          throw new PermanentError(`vendor invitation ${event.invitationId} not found`);
        }
        // Never mail a link that cannot be accepted.
        if (!tokenMatches(event.token, invitation.tokenHash)) {
          throw new PermanentError(`vendor invitation ${event.invitationId}: token mismatch`);
        }
        if (invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) {
          ctx.log.info(
            { invitationId: event.invitationId },
            'invitation no longer open; email skipped',
          );
          return;
        }
        const invitee = await ctx.tx.user.findUnique({
          where: { email: invitation.email },
          select: { name: true, primaryLocale: true },
        });
        const acceptUrl = new URL('/invite', deps.adminOrigin);
        acceptUrl.searchParams.set('token', event.token);
        await deps.mailer.send({
          to: invitation.email,
          ...renderVendorInvitation({
            locale: invitee ? fromCoreLocale(invitee.primaryLocale) : DEFAULT_LOCALE,
            name: invitee?.name ?? null,
            vendorName: invitation.vendor.displayName,
            expiresAt: invitation.expiresAt,
            acceptUrl: acceptUrl.toString(),
          }),
        });
        ctx.log.info({ invitationId: event.invitationId }, 'invitation email sent');
      },
      { secretKeys: ['token'] },
    ),
  } satisfies Record<string, OutboxHandler>;
}
