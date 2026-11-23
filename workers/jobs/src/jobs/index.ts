import type { Logger } from '../logger';
import { autoCompleteSubOrders } from './auto-complete-sub-orders';
import { expireUnpaidOrders } from './expire-unpaid-orders';
import { pruneOutbox } from './outbox-retention';
import { releasePayouts } from './release-payouts';
import type { JobSummary } from './run';

/** Scheduled jobs; each name is also its BullMQ job-scheduler id (one schedule per name). */
export const JOB_NAMES = [
  'expire-unpaid-orders',
  'auto-complete-sub-orders',
  'release-payouts',
  'outbox-retention',
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}

export interface JobsConfig {
  batchSize: number;
  /** Processed outbox rows older than this are deleted by `outbox-retention`. */
  outboxRetentionDays: number;
}

/** A job run over every due row; stops between rows once `signal` aborts. */
export type JobRunner = (signal?: AbortSignal) => Promise<JobSummary>;

/** One runner per job: runs it once over every due row and returns what it did. */
export function createJobs(config: JobsConfig, log: Logger): Record<JobName, JobRunner> {
  const ctx = (job: JobName, signal: AbortSignal | undefined) => ({
    log: log.child({ job }),
    batchSize: config.batchSize,
    ...(signal ? { signal } : {}),
  });
  return {
    'expire-unpaid-orders': (signal) => expireUnpaidOrders(ctx('expire-unpaid-orders', signal)),
    'auto-complete-sub-orders': (signal) =>
      autoCompleteSubOrders(ctx('auto-complete-sub-orders', signal)),
    'release-payouts': (signal) => releasePayouts(ctx('release-payouts', signal)),
    'outbox-retention': (signal) =>
      pruneOutbox({
        ...ctx('outbox-retention', signal),
        retentionDays: config.outboxRetentionDays,
      }),
  };
}
