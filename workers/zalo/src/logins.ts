import type { Redis } from 'ioredis';
import {
  ZALO_LOGIN_QUEUE_KEY,
  ZaloLoginIdSchema,
  ZaloLoginRecordSchema,
  zaloLoginKey,
  type ZaloLoginRecord,
  type ZaloLoginState,
} from '@repo/core';
import { errorMessage, type AccountManager } from './accounts.js';
import type { Env } from './env.js';
import { QrLoginEndedError, type ZaloGateway } from './gateway.js';
import type { Logger } from './logger.js';

// QR logins requested by vendors. The API stores `zaloLoginKey(id)` = ZaloLoginRecord (PENDING)
// and LPUSHes the id onto ZALO_LOGIN_QUEUE_KEY; any replica BRPOPs it, runs the zca-js QR flow and
// overwrites the record's `state` (QR_READY → SCANNED → SUCCESS | EXPIRED | DECLINED | FAILED) for
// the vendor UI to poll. Writes use KEEPTTL + XX so an expired record is never resurrected.

const POP_TIMEOUT_S = 1;
const BUSY_WAIT_MS = 500;

export interface QrLoginProcessorDeps {
  redis: Redis;
  /** Dedicated connection: BRPOP blocks it. */
  blockingRedis: Redis;
  gateway: ZaloGateway;
  accounts: AccountManager;
  logger: Logger;
  env: Pick<Env, 'ZALO_MAX_CONCURRENT_LOGINS' | 'ZALO_QR_LOGIN_TIMEOUT_MS'>;
}

export class QrLoginProcessor {
  private running = false;
  private loop: Promise<void> | undefined;
  private readonly inFlight = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();

  constructor(private readonly deps: QrLoginProcessorDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  /** Stops popping, aborts QR flows in progress (their state becomes FAILED) and waits for them. */
  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    for (const { controller } of this.inFlight.values()) controller.abort();
    await Promise.allSettled([...this.inFlight.values()].map((entry) => entry.done));
  }

  /** Handles one login id end to end (exported for tests). */
  async handle(loginId: string, signal: AbortSignal): Promise<void> {
    const { redis, logger } = this.deps;
    if (!ZaloLoginIdSchema.safeParse(loginId).success) return;
    const key = zaloLoginKey(loginId);
    const raw = await redis.get(key);
    if (raw === null) return; // expired before we got to it
    const parsed = ZaloLoginRecordSchema.safeParse(safeJson(raw));
    if (!parsed.success) {
      logger.warn({ loginId }, 'unparsable zalo login record');
      return;
    }
    const record = parsed.data;
    if (record.state.state !== 'PENDING') return; // already handled (duplicate queue entry)

    const setState = (state: ZaloLoginState): Promise<unknown> =>
      redis.set(
        key,
        JSON.stringify({ ...record, state } satisfies ZaloLoginRecord),
        'KEEPTTL',
        'XX',
      );

    let session;
    try {
      session = await this.deps.gateway.loginWithQr((event) => {
        const state: ZaloLoginState =
          event.type === 'qr'
            ? { state: 'QR_READY', qrImage: `data:image/png;base64,${event.image}` }
            : { state: 'SCANNED', displayName: event.displayName, avatarUrl: event.avatarUrl };
        setState(state).catch((err: unknown) =>
          logger.warn({ loginId, error: errorMessage(err) }, 'login state write failed'),
        );
      }, signal);
    } catch (err) {
      const reason = err instanceof QrLoginEndedError ? err.reason : undefined;
      if (reason === undefined)
        logger.warn({ loginId, error: errorMessage(err) }, 'zalo QR login failed');
      await setState(
        reason === 'expired'
          ? { state: 'EXPIRED' }
          : reason === 'declined'
            ? { state: 'DECLINED' }
            : { state: 'FAILED', reason: 'login-failed' },
      );
      return;
    }

    try {
      const result = await this.deps.accounts.connect(record.vendorId, session);
      if (result === 'already-linked') {
        session.close();
        await setState({ state: 'FAILED', reason: 'already-linked' });
        return;
      }
      await setState({ state: 'SUCCESS', displayName: session.displayName });
    } catch (err) {
      session.close();
      logger.error({ loginId, error: errorMessage(err) }, 'storing zalo account failed');
      await setState({ state: 'FAILED', reason: 'login-failed' });
    }
  }

  private async run(): Promise<void> {
    const { blockingRedis, logger, env } = this.deps;
    while (this.running) {
      if (this.inFlight.size >= env.ZALO_MAX_CONCURRENT_LOGINS) {
        await sleep(BUSY_WAIT_MS);
        continue;
      }
      let popped: [string, string] | null;
      try {
        popped = await blockingRedis.brpop(ZALO_LOGIN_QUEUE_KEY, POP_TIMEOUT_S);
      } catch (err) {
        if (!this.running) return;
        logger.error({ error: errorMessage(err) }, 'zalo login queue pop failed');
        await sleep(BUSY_WAIT_MS);
        continue;
      }
      if (popped === null) continue;
      this.spawn(popped[1]);
    }
  }

  private spawn(loginId: string): void {
    if (this.inFlight.has(loginId)) return; // duplicate queue entry while the first still runs
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.env.ZALO_QR_LOGIN_TIMEOUT_MS);
    const done = this.handle(loginId, controller.signal)
      .catch((err: unknown) =>
        this.deps.logger.error({ loginId, error: errorMessage(err) }, 'zalo login crashed'),
      )
      .finally(() => {
        clearTimeout(timer);
        this.inFlight.delete(loginId);
      });
    this.inFlight.set(loginId, { controller, done });
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
