import { prisma } from '@repo/db';
import { finishSentCampaigns, startCampaign } from '../crm/campaigns';
import { dispatchMessage, type CrmDispatchDeps } from '../crm/dispatch';
import { describeError } from '../logger';
import { PermanentError } from '../outbox/errors';
import { forEachCandidate, type JobContext, type JobSummary } from './run';

/** A message whose send keeps failing becomes FAILED after this many attempts. */
export const CRM_MAX_ATTEMPTS = 5;
/**
 * Messages handled per `crm-dispatch-messages` run; the rest wait for the next run (1 min). Keeps a
 * large campaign from holding the single scheduled-job slot (`concurrency: 1`) for hours while
 * payment expiry / payouts queue behind it.
 */
export const CRM_DISPATCH_MAX_PER_RUN = 200;
/** Retry delay after a failed send, in minutes: 5, 10, 20, … capped at 6 h. */
export function crmRetryDelayMinutes(attempt: number): number {
  return Math.min(5 * 2 ** Math.max(0, attempt - 1), 6 * 60);
}

/** Campaign start resolves the whole audience and inserts its messages: allow more than a row job. */
const CAMPAIGN_TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const;
/** One message decision: a few reads / writes, no network call (the email is sent after commit). */
const MESSAGE_TX_OPTIONS = { timeout: 15_000, maxWait: 10_000 } as const;

/**
 * `crm-start-campaigns`: SCHEDULED campaigns with `scheduledAt ≤ now` (DB clock) → `startCampaign`
 * (one transaction each; usually the `crm.campaign.scheduled` handler got there first and the
 * campaign is skipped), then `finishSentCampaigns`.
 */
export async function startDueCampaigns(ctx: JobContext): Promise<JobSummary> {
  const summary = await forEachCandidate<{ id: string }>(
    ctx,
    (afterId, limit) => prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM crm_campaigns
      WHERE status = 'SCHEDULED' AND scheduled_at <= (now() AT TIME ZONE 'UTC') AND id > ${afterId}
      ORDER BY id
      LIMIT ${limit}::int`,
    async (campaign) => {
      const result = await prisma.$transaction(
        (tx) => startCampaign(tx, campaign.id, ctx.log),
        CAMPAIGN_TX_OPTIONS,
      );
      return result.outcome === 'not-due' ? 'skipped' : 'done';
    },
  );
  const finished = await finishSentCampaigns();
  if (finished > 0) ctx.log.info({ finished }, 'crm campaigns sent');
  return summary;
}

/**
 * `crm-dispatch-messages`: up to `CRM_DISPATCH_MAX_PER_RUN` SCHEDULED `crm_messages` with
 * `scheduledFor ≤ now` (partial index `crm_messages_due_idx`). Each: `dispatchMessage` in its own
 * transaction (SENT / SKIPPED = `done`; already handled or locked by another worker = `skipped`),
 * then — after the commit — the email. A failure is recorded outside the rolled-back work:
 * `attempts + 1`, `lastError` (first line, emails scrubbed), retried after `crmRetryDelayMinutes`
 * (DB clock), FAILED at `CRM_MAX_ATTEMPTS` or at once for a `PermanentError`; a failed email also
 * reverts the SENT mark and deletes the in-app notification (`revertSent`), so the retry re-checks
 * everything and never duplicates the notification. Ends with `finishSentCampaigns`.
 */
export async function dispatchDueCrmMessages(
  ctx: JobContext,
  deps: CrmDispatchDeps,
): Promise<JobSummary> {
  const cap = new AbortController();
  const stopOuter = () => cap.abort();
  ctx.signal?.addEventListener('abort', stopOuter, { once: true });
  if (ctx.signal?.aborted) cap.abort();
  let handled = 0;
  try {
    const summary = await forEachCandidate<{ id: string }>(
      { ...ctx, signal: cap.signal },
      (afterId, limit) => prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM crm_messages
        WHERE status = 'SCHEDULED' AND scheduled_for <= (now() AT TIME ZONE 'UTC')
          AND id > ${afterId}
        ORDER BY id
        LIMIT ${limit}::int`,
      async (message) => {
        handled += 1;
        if (handled >= CRM_DISPATCH_MAX_PER_RUN) cap.abort(); // stops before the next row
        let result;
        try {
          result = await prisma.$transaction(
            (tx) => dispatchMessage(tx, message.id, deps),
            MESSAGE_TX_OPTIONS,
          );
        } catch (error) {
          await recordFailure(message.id, 'SCHEDULED', error);
          throw error;
        }
        if (result.outcome === 'gone') return 'skipped';
        if (result.outcome === 'sent' && result.email !== null) {
          try {
            await deps.mailer.send(result.email);
          } catch (error) {
            await recordFailure(message.id, 'SENT', error, result.notificationId);
            throw error;
          }
        }
        return 'done';
      },
    );
    await finishSentCampaigns();
    return summary;
  } finally {
    ctx.signal?.removeEventListener('abort', stopOuter);
  }
}

/**
 * Records a failed attempt on a message still in `from` (SCHEDULED: the decision transaction
 * threw; SENT: the email failed after the commit — `revertSent`). In one transaction: the row back
 * to SCHEDULED at `now + crmRetryDelayMinutes(attempts)` (DB clock), or FAILED; for SENT the SENT
 * mark is undone and the in-app notification deleted, so a FAILED message has delivered nothing.
 */
async function recordFailure(
  id: string,
  from: 'SCHEDULED' | 'SENT',
  error: unknown,
  notificationId: string | null = null,
): Promise<void> {
  // First line only: Prisma errors can echo call arguments (message text with names) further down.
  const lastError = describeError(error).split('\n')[0] ?? '';
  await prisma.$transaction(async (tx) => {
    const row = await tx.crmMessage.findUnique({
      where: { id },
      select: { status: true, attempts: true },
    });
    if (row?.status !== from) return;
    // A SENT row already counted this attempt when it was marked SENT.
    const attempts = from === 'SENT' ? row.attempts : row.attempts + 1;
    const failed = error instanceof PermanentError || attempts >= CRM_MAX_ATTEMPTS;
    await tx.$executeRaw`
      UPDATE crm_messages
      SET attempts = ${attempts}::int,
          last_error = ${lastError},
          status = ${failed ? 'FAILED' : 'SCHEDULED'}::"CrmMessageStatus",
          scheduled_for = CASE WHEN ${failed} THEN scheduled_for
            ELSE (now() AT TIME ZONE 'UTC') + make_interval(mins => ${crmRetryDelayMinutes(attempts)}::int)
          END,
          sent_at = NULL,
          notification_id = NULL,
          updated_at = (now() AT TIME ZONE 'UTC')
      WHERE id = ${id} AND status = ${from}::"CrmMessageStatus"`;
    if (notificationId !== null) {
      await tx.notification.deleteMany({ where: { id: notificationId } });
    }
  });
}
