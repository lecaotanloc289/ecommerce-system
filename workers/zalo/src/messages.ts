import type { Redis } from 'ioredis';
import {
  Money,
  ShippingAddressSnapshotSchema,
  formatOrderCode,
  renderZaloTemplate,
  type ZaloSkipReason,
  type ZaloTemplateVars,
} from '@repo/core';
import { prisma, toMoney } from '@repo/db';
import { formatMoney, fromCoreLocale } from '@repo/i18n';
import { errorMessage, type AccountManager, type HeldAccount } from './accounts.js';
import type { Env } from './env.js';
import { withTimeout } from './gateway.js';
import type { Logger } from './logger.js';

// Delivery of `zalo_messages` rows (written by the API in the order transaction). Per held account:
// claim the oldest due PENDING row (→ SENDING with a lock lease), render the vendor template, look
// the customer up by the shipping-address phone, send, then SENT / SKIPPED / retry (PENDING with
// backoff) / FAILED. At-least-once: a crash between send and the SENT write re-sends after the lock
// lease expires.

const LOCK_SECONDS = 120;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 3_600_000;
const RECIPIENT_FOUND_TTL_S = 30 * 24 * 3600;
const RECIPIENT_MISSING_TTL_S = 24 * 3600;
const FINISH_WRITE_ATTEMPTS = 3;
const FINISH_RETRY_MS = 500;
const PRUNE_EVERY_MS = 3_600_000;

/** Care message only makes sense while the goods are still with the customer. */
const AFTER_DELIVERY_STATUSES: ReadonlySet<string> = new Set(['DELIVERED', 'COMPLETED']);
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['CANCELLED', 'REFUNDED']);
const CLOSING_EVENTS: ReadonlySet<string> = new Set(['ORDER_CANCELLED', 'ORDER_REFUNDED']);

export const recipientKey = (accountId: string, phone: string): string =>
  `zalo:recipient:${accountId}:${phone}`;

/**
 * Vietnamese mobile number → `0xxxxxxxxx` (zca-js turns a leading 0 into 84 itself), or null when
 * the phone is not a VN number Zalo can look up.
 */
export function normalizeVnPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length === 11) return `0${digits.slice(2)}`;
  if (digits.startsWith('0') && digits.length === 10) return digits;
  return null;
}

export interface MessageSenderDeps {
  redis: Redis;
  accounts: AccountManager;
  logger: Logger;
  env: Pick<
    Env,
    | 'ZALO_SEND_MIN_INTERVAL_MS'
    | 'ZALO_MESSAGE_MAX_AGE_HOURS'
    | 'ZALO_MESSAGE_RETENTION_DAYS'
    | 'ZALO_MAX_SEND_ATTEMPTS'
    | 'ZALO_CALL_TIMEOUT_MS'
  >;
  now?: () => number;
}

interface Claim {
  id: string;
  lockedUntil: Date;
}

interface SubOrderForRender {
  currency: 'VND' | 'USD';
  subtotalAmount: bigint;
  shippingAmount: bigint;
  discountAmount: bigint;
  platformDiscountAmount: bigint;
  carrier: string | null;
  trackingNumber: string | null;
  items: { productTitleSnapshot: string; quantity: number }[];
  vendor: { displayName: string };
  order: { id: string; customer: { primaryLocale: 'VI' | 'EN' } };
}

type Outcome =
  | { kind: 'sent'; renderedBody: string; zaloMessageId: string }
  | { kind: 'skipped'; reason: ZaloSkipReason };

export class MessageSender {
  private readonly now: () => number;
  private lastPruneAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: MessageSenderDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** One poll: housekeeping, then at most one message per idle held account (in parallel). */
  async tick(): Promise<void> {
    await this.housekeeping();
    const now = this.now();
    const ready = this.deps.accounts
      .heldAccounts()
      .filter((held) => !held.busy && held.nextCallAt <= now);
    await Promise.all(ready.map((held) => this.sendNext(held)));
  }

  /** Crashed claims back to PENDING; undeliverable rows to SKIPPED (any replica may do this). */
  async housekeeping(): Promise<void> {
    const now = new Date(this.now());
    await prisma.zaloMessage.updateMany({
      where: { status: 'SENDING', lockedUntil: { lt: now } },
      data: { status: 'PENDING', lockedUntil: null },
    });
    // Disconnected shop: nothing will ever send these.
    await prisma.zaloMessage.updateMany({
      where: { status: 'PENDING', vendor: { zaloAccount: { is: { status: 'DISCONNECTED' } } } },
      data: { status: 'SKIPPED', skipReason: 'account-unavailable' },
    });
    // Expired session not re-scanned in time (or a backlog that never drained).
    const maxAgeMs = this.deps.env.ZALO_MESSAGE_MAX_AGE_HOURS * 3_600_000;
    await prisma.zaloMessage.updateMany({
      where: { status: 'PENDING', scheduledAt: { lt: new Date(now.getTime() - maxAgeMs) } },
      data: { status: 'SKIPPED', skipReason: 'account-unavailable' },
    });
    await this.prune(now.getTime());
  }

  /** Retention: finished rows past ZALO_MESSAGE_RETENTION_DAYS are deleted (at most hourly). */
  private async prune(now: number): Promise<void> {
    if (now - this.lastPruneAt < PRUNE_EVERY_MS) return;
    this.lastPruneAt = now;
    const cutoff = new Date(now - this.deps.env.ZALO_MESSAGE_RETENTION_DAYS * 86_400_000);
    const { count } = await prisma.zaloMessage.deleteMany({
      where: { status: { in: ['SENT', 'SKIPPED', 'FAILED'] }, updatedAt: { lt: cutoff } },
    });
    if (count > 0) this.deps.logger.info({ count }, 'pruned old zalo messages');
  }

  private async sendNext(held: HeldAccount): Promise<void> {
    held.busy = true;
    try {
      const claim = await this.claim(held.vendorId);
      if (claim === null) return;
      const calledZalo = await this.process(claim, held);
      if (calledZalo) held.nextCallAt = this.now() + this.deps.env.ZALO_SEND_MIN_INTERVAL_MS;
    } catch (err) {
      this.deps.logger.error(
        { accountId: held.accountId, error: errorMessage(err) },
        'zalo send loop failed',
      );
    } finally {
      held.busy = false;
    }
  }

  /**
   * Oldest due PENDING row of the vendor → SENDING. Timestamps are UTC `timestamp(3)` (Prisma).
   * The returned `lockedUntil` is the claim token: every later write is guarded on it, so a late
   * finisher can never overwrite a row that was reclaimed and claimed again.
   */
  private async claim(vendorId: string): Promise<Claim | null> {
    const rows = await prisma.$queryRaw<Claim[]>`
      UPDATE zalo_messages
         SET status = 'SENDING',
             locked_until = date_trunc('milliseconds', now() AT TIME ZONE 'UTC') + make_interval(secs => ${LOCK_SECONDS}),
             updated_at = (now() AT TIME ZONE 'UTC')
       WHERE id = (
         SELECT id FROM zalo_messages
          WHERE vendor_id = ${vendorId}
            AND status = 'PENDING'
            AND scheduled_at <= (now() AT TIME ZONE 'UTC')
            AND next_attempt_at <= (now() AT TIME ZONE 'UTC')
          ORDER BY scheduled_at, id
          LIMIT 1
          FOR UPDATE SKIP LOCKED)
      RETURNING id, locked_until AS "lockedUntil"`;
    return rows[0] ?? null;
  }

  /** Returns whether Zalo was called (for pacing). Never throws for a per-message failure. */
  private async process(claim: Claim, held: HeldAccount): Promise<boolean> {
    const message = await prisma.zaloMessage.findUnique({
      where: { id: claim.id },
      include: {
        subOrder: {
          include: {
            items: {
              select: { productTitleSnapshot: true, quantity: true },
              orderBy: { id: 'asc' },
            },
            vendor: { select: { displayName: true, status: true } },
            order: { select: { id: true, customer: { select: { primaryLocale: true } } } },
          },
        },
      },
    });
    if (message === null) return false;
    const { subOrder } = message;

    const skip = async (reason: ZaloSkipReason): Promise<false> => {
      await this.finish(claim, { kind: 'skipped', reason });
      return false;
    };
    if (subOrder.vendor.status !== 'ACTIVE') return skip('vendor-inactive');
    const template = await prisma.zaloMessageTemplate.findUnique({
      where: { vendorId_event: { vendorId: message.vendorId, event: message.event } },
    });
    if (template === null || !template.isEnabled) return skip('template-disabled');
    if (message.event === 'AFTER_DELIVERY' && !AFTER_DELIVERY_STATUSES.has(subOrder.status)) {
      return skip('order-status-changed');
    }
    // A late "placed / paid / shipped…" message must not reach a customer whose order was cancelled
    // or refunded meanwhile; the cancel/refund message itself still goes out.
    if (CLOSED_STATUSES.has(subOrder.status) && !CLOSING_EVENTS.has(message.event)) {
      return skip('order-status-changed');
    }
    const address = ShippingAddressSnapshotSchema.safeParse(subOrder.shippingAddress);
    const phone = address.success ? normalizeVnPhone(address.data.phone) : null;
    if (!address.success || phone === null) return skip('invalid-phone');

    const timeout = this.deps.env.ZALO_CALL_TIMEOUT_MS;
    let calledZalo = false;
    let outcome: Outcome;
    try {
      const cacheKey = recipientKey(held.accountId, phone);
      const cached = await this.deps.redis.get(cacheKey);
      let uid: string | null;
      if (cached !== null) {
        uid = cached === '' ? null : cached;
      } else {
        calledZalo = true;
        uid = await withTimeout(held.session.findUserByPhone(phone), timeout, 'zalo findUser');
        await this.deps.redis.set(
          cacheKey,
          uid ?? '',
          'EX',
          uid === null ? RECIPIENT_MISSING_TTL_S : RECIPIENT_FOUND_TTL_S,
        );
      }
      if (uid === null) {
        outcome = { kind: 'skipped', reason: 'recipient-not-found' };
      } else if (!(await this.deps.accounts.ownsLease(held))) {
        // Another replica took this account over (QR re-login / stalled renewals): hand the row back.
        await this.release(claim);
        return calledZalo;
      } else {
        const renderedBody = renderZaloTemplate(
          template.body,
          this.vars(message.subOrder, address.data.recipientName),
        );
        calledZalo = true;
        const { messageId } = await withTimeout(
          held.session.sendText(uid, renderedBody),
          timeout,
          'zalo send',
        );
        outcome = { kind: 'sent', renderedBody, zaloMessageId: messageId };
      }
    } catch (err) {
      await this.retryOrFail(claim, message.attempts + 1, err);
      return calledZalo;
    }
    // Outside the try: a failed DB write after a successful send must not count as a send failure
    // (that would message the customer again on retry).
    await this.finish(claim, outcome);
    return calledZalo;
  }

  private vars(subOrder: SubOrderForRender, customerName: string): ZaloTemplateVars {
    const money = (amount: bigint) => toMoney(amount, subOrder.currency);
    const total = Money.subtract(
      Money.add(money(subOrder.subtotalAmount), money(subOrder.shippingAmount)),
      Money.add(money(subOrder.discountAmount), money(subOrder.platformDiscountAmount)),
    );
    return {
      customerName,
      orderCode: formatOrderCode(subOrder.order.id),
      shopName: subOrder.vendor.displayName,
      total: formatMoney(total, fromCoreLocale(subOrder.order.customer.primaryLocale)),
      itemList: subOrder.items
        .map((item) => `• ${item.productTitleSnapshot} x${item.quantity}`)
        .join('\n'),
      carrier: subOrder.carrier ?? '',
      trackingNumber: subOrder.trackingNumber ?? '',
    };
  }

  /** Final write, retried a few times; if it still fails the lock expires and the row is retried. */
  private async finish(claim: Claim, outcome: Outcome): Promise<void> {
    const data =
      outcome.kind === 'sent'
        ? {
            status: 'SENT' as const,
            renderedBody: outcome.renderedBody,
            zaloMessageId: outcome.zaloMessageId,
            sentAt: new Date(this.now()),
            lockedUntil: null,
            lastError: null,
          }
        : { status: 'SKIPPED' as const, skipReason: outcome.reason, lockedUntil: null };
    for (let attempt = 1; ; attempt += 1) {
      try {
        await prisma.zaloMessage.updateMany({ where: this.claimed(claim), data });
        return;
      } catch (err) {
        if (attempt >= FINISH_WRITE_ATTEMPTS) {
          this.deps.logger.error(
            { messageId: claim.id, outcome: outcome.kind, error: errorMessage(err) },
            'zalo message result not stored; the row will be retried after its lock expires',
          );
          return;
        }
        await sleep(FINISH_RETRY_MS * attempt);
      }
    }
  }

  /** Lease lost before sending: back to PENDING without spending an attempt. */
  private async release(claim: Claim): Promise<void> {
    await prisma.zaloMessage.updateMany({
      where: this.claimed(claim),
      data: { status: 'PENDING', lockedUntil: null },
    });
  }

  private async retryOrFail(claim: Claim, attempts: number, err: unknown): Promise<void> {
    const lastError = errorMessage(err);
    const failed = attempts >= this.deps.env.ZALO_MAX_SEND_ATTEMPTS;
    const delay = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
    this.deps.logger.warn(
      { messageId: claim.id, attempts, failed, error: lastError },
      'zalo send failed',
    );
    await prisma.zaloMessage.updateMany({
      where: this.claimed(claim),
      data: failed
        ? { status: 'FAILED', attempts, lastError, lockedUntil: null }
        : {
            status: 'PENDING',
            attempts,
            lastError,
            lockedUntil: null,
            nextAttemptAt: new Date(this.now() + delay),
          },
    });
  }

  private claimed(claim: Claim) {
    return { id: claim.id, status: 'SENDING' as const, lockedUntil: claim.lockedUntil };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
