import { prisma } from '@repo/db';
import type { JobContext, JobSummary } from './run';

/**
 * `outbox-retention`: deletes PROCESSED outbox rows older than `retentionDays` (DB clock), in
 * batches so no statement holds many row locks. Unprocessed rows — pending, retrying or
 * dead-lettered (`processed_at` stays NULL) — are never deleted.
 */
export async function pruneOutbox(
  ctx: JobContext & { retentionDays: number },
): Promise<JobSummary> {
  let done = 0;
  for (;;) {
    if (ctx.signal?.aborted) return { candidates: done, done, skipped: 0, failed: 0 };
    const deleted = await prisma.$executeRaw`
      DELETE FROM outbox_events
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE processed_at IS NOT NULL
          AND processed_at < (now() AT TIME ZONE 'UTC')
            - make_interval(days => ${ctx.retentionDays}::int)
        LIMIT ${ctx.batchSize}::int)`;
    done += deleted;
    if (deleted < ctx.batchSize) return { candidates: done, done, skipped: 0, failed: 0 };
  }
}
