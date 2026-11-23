import { describeError, type Logger } from '../logger';

export interface JobContext {
  log: Logger;
  /** Candidates read per query (keyset pages by id; a run walks every page once). */
  batchSize: number;
  /** Shutdown: the run stops between rows (the current row's transaction finishes). */
  signal?: AbortSignal;
}

export interface JobSummary {
  /** Rows selected as due. */
  candidates: number;
  /** Rows changed by this run. */
  done: number;
  /** Rows no longer due once locked (another worker / the API got there first) or refused. */
  skipped: number;
  /** Rows whose transaction threw (logged; retried on the next run). */
  failed: number;
}

export type ItemOutcome = 'done' | 'skipped';

/** One interactive transaction per row: bounded, never holding locks across rows. */
export const JOB_TX_OPTIONS = { timeout: 15_000, maxWait: 10_000 } as const;

/**
 * Walks the due rows in id order, one keyset page at a time (`id > last`), handling each in its
 * own transaction. A row that fails is logged and left for the next run; a row that stays due
 * (e.g. skipped for a currency mismatch) is visited once per run, so a run always ends. An
 * aborted `ctx.signal` ends the run early between rows (the rest waits for the next run).
 */
export async function forEachCandidate<T extends { id: string }>(
  ctx: JobContext,
  select: (afterId: string, limit: number) => Promise<T[]>,
  handle: (candidate: T) => Promise<ItemOutcome>,
): Promise<JobSummary> {
  const summary: JobSummary = { candidates: 0, done: 0, skipped: 0, failed: 0 };
  let afterId = '';
  for (;;) {
    if (ctx.signal?.aborted) return summary;
    const page = await select(afterId, ctx.batchSize);
    for (const candidate of page) {
      if (ctx.signal?.aborted) return summary;
      summary.candidates += 1;
      try {
        summary[await handle(candidate)] += 1;
      } catch (error) {
        summary.failed += 1;
        ctx.log.error({ id: candidate.id, err: describeError(error) }, 'job item failed');
      }
    }
    const last = page.at(-1);
    if (!last || page.length < ctx.batchSize) return summary;
    afterId = last.id;
  }
}
