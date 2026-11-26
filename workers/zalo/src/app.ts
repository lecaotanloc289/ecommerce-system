import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Redis } from 'ioredis';
import { prisma } from '@repo/db';
import { AccountManager, errorMessage } from './accounts.js';
import { CredentialsCipher } from './credentials.js';
import type { Env } from './env.js';
import type { ZaloGateway } from './gateway.js';
import type { Logger } from './logger.js';
import { QrLoginProcessor } from './logins.js';
import { MessageSender } from './messages.js';
import { ZcaGateway } from './zca-gateway.js';

export interface ZaloWorkerApp {
  readonly accounts: AccountManager;
  readonly sender: MessageSender;
  readonly logins: QrLoginProcessor;
  start(): void;
  stop(): Promise<void>;
}

export interface ZaloWorkerOptions {
  /** Defaults to the zca-js adapter; tests pass a fake. */
  gateway?: ZaloGateway;
  instanceId?: string;
}

/** Repeats `task` every `intervalMs` after the previous run finished (no overlap). */
function loop(name: string, intervalMs: number, task: () => Promise<void>, logger: Logger) {
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<void> | undefined;
  let running = false;
  const tick = (): void => {
    current = task()
      .catch((err: unknown) =>
        logger.error({ error: errorMessage(err), loop: name }, 'zalo worker loop failed'),
      )
      .finally(() => {
        if (running) timer = setTimeout(tick, intervalMs);
      });
  };
  return {
    start(): void {
      running = true;
      tick();
    },
    async stop(): Promise<void> {
      running = false;
      clearTimeout(timer);
      await current;
    },
  };
}

export function createZaloWorkerApp(
  env: Env,
  logger: Logger,
  options: ZaloWorkerOptions = {},
): ZaloWorkerApp {
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const blockingRedis = redis.duplicate();
  const gateway = options.gateway ?? new ZcaGateway();
  const instanceId =
    options.instanceId ?? `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;

  const accounts = new AccountManager({
    redis,
    gateway,
    cipher: new CredentialsCipher(env.ZALO_CREDENTIALS_KEY),
    logger,
    env,
    instanceId,
  });
  const sender = new MessageSender({ redis, accounts, logger, env });
  const logins = new QrLoginProcessor({ redis, blockingRedis, gateway, accounts, logger, env });

  const syncLoop = loop(
    'account-sync',
    env.ZALO_ACCOUNT_SYNC_INTERVAL_MS,
    () => accounts.sync(),
    logger,
  );
  const sendLoop = loop('send', env.ZALO_POLL_INTERVAL_MS, () => sender.tick(), logger);

  return {
    accounts,
    sender,
    logins,
    start() {
      logger.info({ instanceId }, 'zalo worker starting');
      syncLoop.start();
      sendLoop.start();
      logins.start();
    },
    async stop() {
      await logins.stop();
      await sendLoop.stop();
      await syncLoop.stop();
      await accounts.stop();
      blockingRedis.disconnect();
      await redis.quit();
      await prisma.$disconnect();
    },
  };
}
