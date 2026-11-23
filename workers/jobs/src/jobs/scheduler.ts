import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { describeError, type Logger } from '../logger';

/** BullMQ queue holding the repeatable jobs (one job scheduler per job name). */
export const JOBS_QUEUE = 'scheduled-jobs';

export interface ScheduledJob {
  /** Repeat interval. */
  everyMs: number;
  /** One run; must stop soon (between rows) once `signal` aborts — `close()` aborts it. */
  run: (signal: AbortSignal) => Promise<unknown>;
}

/**
 * Repeatable jobs on BullMQ (roadmap D10): one `upsertJobScheduler(name, { every })` per job — the
 * fixed scheduler id means every worker process upserts the SAME schedule (no duplicates however
 * many machines boot), and BullMQ hands each produced job to exactly one worker (the job lock).
 * Runs never overlap within a process (`concurrency: 1`); across processes a slow run may overlap
 * the next one, which the jobs tolerate (row locks + conditional updates). A failed run is logged
 * and simply retried at the next interval (no BullMQ retries).
 */
export class JobScheduler {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly stopping = new AbortController();
  private closing: Promise<void> | null = null;

  constructor(
    private readonly connection: Redis,
    private readonly jobs: Readonly<Record<string, ScheduledJob>>,
    private readonly log: Logger,
    private readonly queueName: string = JOBS_QUEUE,
  ) {}

  async start(): Promise<void> {
    const queue = new Queue(this.queueName, { connection: this.connection });
    this.queue = queue;
    for (const [name, job] of Object.entries(this.jobs)) {
      await queue.upsertJobScheduler(
        name,
        { every: job.everyMs },
        {
          name,
          data: {},
          opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
        },
      );
    }

    if (this.closing) return; // shutdown arrived while the schedules were being upserted
    const worker = new Worker(this.queueName, (bull: Job) => this.process(bull), {
      connection: this.connection,
      concurrency: 1,
    });
    worker.on('failed', (bull, error) => {
      this.log.error({ job: bull?.name, err: describeError(error) }, 'scheduled job failed');
    });
    worker.on('error', (error) => {
      this.log.error({ err: describeError(error) }, 'scheduled job worker error');
    });
    this.worker = worker;
    this.log.info(
      Object.fromEntries(Object.entries(this.jobs).map(([name, job]) => [name, job.everyMs])),
      'scheduled jobs started (every ms)',
    );
  }

  /**
   * Stops taking jobs, tells the running one to stop between rows and waits for it, then closes
   * the queue (not the shared connection). Idempotent: concurrent calls share one close.
   */
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.stopping.abort();
      await this.worker?.close();
      await this.queue?.close();
    })();
    return this.closing;
  }

  private async process(bull: Job): Promise<unknown> {
    const job = Object.hasOwn(this.jobs, bull.name) ? this.jobs[bull.name] : undefined;
    if (!job) throw new Error(`unknown scheduled job "${bull.name}"`);
    const startedAt = Date.now();
    const result = await job.run(this.stopping.signal);
    this.log.info(
      { job: bull.name, result, durationMs: Date.now() - startedAt },
      'scheduled job finished',
    );
    return result;
  }
}
