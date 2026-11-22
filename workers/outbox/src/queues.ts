import type { BackoffStrategy, DefaultJobOptions } from 'bullmq';

/** One job per `outbox_events` row; `jobId` = outbox id (dedupe across dispatcher retries). */
export const OUTBOX_QUEUE = 'outbox';
/** Delayed jobs that end a LIVE session whose encoder stayed disconnected past the grace period. */
export const LIVE_DISCONNECT_GRACE_QUEUE = 'live-disconnect-grace';

export const BACKOFF_TYPE = 'capped-exponential';
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 10 * 60_000;

/** 2 s, 4 s, 8 s … doubling, capped at 10 min. Registered on every Worker via `WORKER_SETTINGS`. */
export const cappedExponentialBackoff: BackoffStrategy = (attemptsMade) =>
  Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attemptsMade - 1), BACKOFF_CAP_MS);

export const WORKER_SETTINGS = { backoffStrategy: cappedExponentialBackoff };

/**
 * 15 attempts with capped exponential backoff (2 s → … → 512 s, then 10 min each): about 67 min
 * of retries, enough to ride out a provider or DB outage. Failed jobs are kept 7 days for manual
 * re-runs (see CLAUDE.md "Ops"). Completed jobs are kept by age only (24 h), so a row that is
 * re-dispatched within that window (dispatcher crashed between `addBulk` and commit — seconds in
 * practice) still dedupes on its jobId; after that window it would run again, which handlers
 * tolerate because they are idempotent.
 */
export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 15,
  backoff: { type: BACKOFF_TYPE },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 7 * 86_400 },
};
