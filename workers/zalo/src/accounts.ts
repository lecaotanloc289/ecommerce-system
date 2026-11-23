import type { Redis } from 'ioredis';
import { ulid } from 'ulid';
import { prisma } from '@repo/db';
import type { CredentialsCipher, ZaloCredentials } from './credentials.js';
import type { Env } from './env.js';
import { ZaloRejectedError, withTimeout, type ZaloGateway, type ZaloSession } from './gateway.js';
import type { Logger } from './logger.js';

// Session holding. Every ACTIVE `zalo_accounts` row is logged in on exactly one replica: the
// holder owns Redis lease `zalo:lease:{accountId}`. A replica only sends for accounts it holds (and
// re-checks the lease right before each send), so a session is never used from two processes (Zalo
// may kick concurrent web sessions). A QR login force-takes the lease; the previous holder notices
// on its next renewal and drops its copy.
//
// Failure policy: only ZaloRejectedError (Zalo answered with an error) counts towards EXPIRED.
// Network errors / timeouts back off and retry forever — an outage must not make every shop re-scan.

export const leaseKey = (accountId: string): string => `zalo:lease:${accountId}`;

const RENEW_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

const RETRY_BASE_MS = 60_000;
const RESTORE_RETRY_MAX_MS = 600_000;
const MAX_ERROR_LENGTH = 1000;

export interface HeldAccount {
  readonly accountId: string;
  readonly vendorId: string;
  session: ZaloSession;
  /** Ciphertext currently stored in the row — writes are guarded on it (a newer login wins). */
  ciphertext: string;
  credentialsJson: string;
  /** Consecutive keep-alive failures of any kind (drives the backoff). */
  keepAliveFailures: number;
  /** Consecutive keep-alive rejections by Zalo (drives EXPIRED). */
  keepAliveRejections: number;
  nextKeepAliveAt: number;
  /** Earliest time the next Zalo call (lookup / send) may run — ZALO_SEND_MIN_INTERVAL_MS pacing. */
  nextCallAt: number;
  busy: boolean;
}

export type ConnectResult = 'connected' | 'already-linked';

export interface AccountManagerDeps {
  redis: Redis;
  gateway: ZaloGateway;
  cipher: CredentialsCipher;
  logger: Logger;
  env: Pick<
    Env,
    | 'ZALO_ACCOUNT_SYNC_INTERVAL_MS'
    | 'ZALO_KEEPALIVE_INTERVAL_MS'
    | 'ZALO_MAX_SESSION_FAILURES'
    | 'ZALO_CALL_TIMEOUT_MS'
  >;
  instanceId: string;
  now?: () => number;
}

/** Error text safe to log/store: name + message only (zca-js errors may carry request headers). */
export function errorMessage(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.slice(0, MAX_ERROR_LENGTH);
}

function uniqueViolationOn(err: unknown, column: string): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err) || err.code !== 'P2002') {
    return false;
  }
  const meta = 'meta' in err ? err.meta : undefined;
  return JSON.stringify(meta ?? '').includes(column);
}

export class AccountManager {
  private readonly held = new Map<string, HeldAccount>();
  private readonly restoreFailures = new Map<
    string,
    { attempts: number; rejections: number; retryAt: number }
  >();
  private readonly leaseTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: AccountManagerDeps) {
    // A sync pass runs its Zalo calls concurrently, each capped at ZALO_CALL_TIMEOUT_MS, so the
    // next renewal comes at most (interval + timeout) after the previous one; keep 2× headroom.
    this.leaseTtlMs = 2 * (deps.env.ZALO_ACCOUNT_SYNC_INTERVAL_MS + deps.env.ZALO_CALL_TIMEOUT_MS);
    this.now = deps.now ?? Date.now;
  }

  /** Accounts this replica holds (and may send for). */
  heldAccounts(): HeldAccount[] {
    return [...this.held.values()];
  }

  /** Whether this replica still owns the account's lease (checked right before each send). */
  async ownsLease(held: HeldAccount): Promise<boolean> {
    return (await this.deps.redis.get(leaseKey(held.accountId))) === this.deps.instanceId;
  }

  /**
   * One sync pass: renew every held lease first (cheap Redis calls), drop what is no longer ours,
   * then restore unheld ACTIVE accounts and run due keep-alives concurrently.
   */
  async sync(): Promise<void> {
    const rows = await prisma.zaloAccount.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, vendorId: true, credentials: true },
    });
    const active = new Map(rows.map((row) => [row.id, row]));

    for (const held of this.heldAccounts()) {
      const row = active.get(held.accountId);
      if (row === undefined || row.credentials !== held.ciphertext) {
        // Disconnected / expired / re-linked elsewhere (a QR login wrote new credentials).
        await this.drop(held, 'account no longer active with these credentials');
        continue;
      }
      if (!(await this.renewLease(held.accountId))) {
        await this.drop(held, 'lease lost', { release: false });
      }
    }

    const now = this.now();
    const tasks: Promise<void>[] = [];
    for (const row of rows) {
      if (this.held.has(row.id) || row.credentials === null) continue;
      const failure = this.restoreFailures.get(row.id);
      if (failure !== undefined && failure.retryAt > now) continue;
      tasks.push(this.restore({ id: row.id, vendorId: row.vendorId, ciphertext: row.credentials }));
    }
    for (const held of this.heldAccounts()) {
      if (held.nextKeepAliveAt <= now) tasks.push(this.keepAlive(held));
    }
    await Promise.all(tasks);
  }

  /**
   * Stores a freshly QR-logged-in session for `vendorId` and starts holding it. One Zalo account
   * serves one shop: a uid already linked to another vendor → 'already-linked'.
   */
  async connect(vendorId: string, session: ZaloSession): Promise<ConnectResult> {
    const credentials = session.credentials();
    const ciphertext = this.deps.cipher.encrypt(credentials, vendorId);
    const linked = await prisma.zaloAccount.findUnique({
      where: { zaloUid: session.uid },
      select: { vendorId: true },
    });
    if (linked !== null && linked.vendorId !== vendorId) return 'already-linked';

    const now = new Date(this.now());
    const fields = {
      status: 'ACTIVE' as const,
      zaloUid: session.uid,
      displayName: session.displayName,
      avatarUrl: session.avatarUrl,
      credentials: ciphertext,
      lastLoginAt: now,
      lastSeenAt: now,
      lastError: null,
    };
    let accountId: string;
    try {
      const account = await prisma.zaloAccount.upsert({
        where: { vendorId },
        create: { id: ulid(), vendorId, ...fields },
        update: fields,
        select: { id: true },
      });
      accountId = account.id;
    } catch (err) {
      // Lost a race on zaloUid → linked elsewhere; any other conflict is a plain failure.
      if (uniqueViolationOn(err, 'zalo_uid')) return 'already-linked';
      throw err;
    }

    await this.deps.redis.set(leaseKey(accountId), this.deps.instanceId, 'PX', this.leaseTtlMs);
    this.held.get(accountId)?.session.close();
    this.restoreFailures.delete(accountId);
    this.held.set(accountId, this.newHeld(accountId, vendorId, session, ciphertext, credentials));
    this.deps.logger.info({ accountId, vendorId }, 'zalo account connected');
    return 'connected';
  }

  /** Releases every lease this replica holds (graceful shutdown → another replica takes over). */
  async stop(): Promise<void> {
    for (const held of this.heldAccounts()) {
      await this.drop(held, 'shutdown');
    }
  }

  private newHeld(
    accountId: string,
    vendorId: string,
    session: ZaloSession,
    ciphertext: string,
    credentials: ZaloCredentials,
  ): HeldAccount {
    return {
      accountId,
      vendorId,
      session,
      ciphertext,
      credentialsJson: JSON.stringify(credentials),
      keepAliveFailures: 0,
      keepAliveRejections: 0,
      nextKeepAliveAt: this.now() + this.deps.env.ZALO_KEEPALIVE_INTERVAL_MS,
      nextCallAt: 0,
      busy: false,
    };
  }

  private async restore(row: { id: string; vendorId: string; ciphertext: string }): Promise<void> {
    const acquired = await this.deps.redis.set(
      leaseKey(row.id),
      this.deps.instanceId,
      'PX',
      this.leaseTtlMs,
      'NX',
    );
    if (acquired === null) return; // held by another replica

    let credentials: ZaloCredentials;
    try {
      credentials = this.deps.cipher.decrypt(row.ciphertext, row.vendorId);
    } catch (err) {
      // Wrong key (rotated) or corrupt row: retrying cannot help — the shop must scan again.
      await this.releaseLease(row.id);
      await this.markExpired(
        row.id,
        row.ciphertext,
        `credentials unreadable: ${errorMessage(err)}`,
      );
      return;
    }

    try {
      const session = await withTimeout(
        this.deps.gateway.login(credentials),
        this.deps.env.ZALO_CALL_TIMEOUT_MS,
        'zalo login',
      );
      this.restoreFailures.delete(row.id);
      this.held.set(
        row.id,
        this.newHeld(row.id, row.vendorId, session, row.ciphertext, credentials),
      );
      this.deps.logger.info({ accountId: row.id }, 'zalo session restored');
    } catch (err) {
      await this.releaseLease(row.id);
      const previous = this.restoreFailures.get(row.id);
      const attempts = (previous?.attempts ?? 0) + 1;
      const rejections = (previous?.rejections ?? 0) + (err instanceof ZaloRejectedError ? 1 : 0);
      this.deps.logger.warn(
        { accountId: row.id, attempts, rejections, error: errorMessage(err) },
        'zalo session restore failed',
      );
      if (rejections >= this.deps.env.ZALO_MAX_SESSION_FAILURES) {
        this.restoreFailures.delete(row.id);
        await this.markExpired(row.id, row.ciphertext, errorMessage(err));
        return;
      }
      this.restoreFailures.set(row.id, {
        attempts,
        rejections,
        retryAt: this.now() + Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RESTORE_RETRY_MAX_MS),
      });
    }
  }

  private async keepAlive(held: HeldAccount): Promise<void> {
    try {
      await withTimeout(
        held.session.keepAlive(),
        this.deps.env.ZALO_CALL_TIMEOUT_MS,
        'zalo keep-alive',
      );
      held.keepAliveFailures = 0;
      held.keepAliveRejections = 0;
      held.nextKeepAliveAt = this.now() + this.deps.env.ZALO_KEEPALIVE_INTERVAL_MS;
      await this.persistAfterKeepAlive(held);
    } catch (err) {
      held.keepAliveFailures += 1;
      if (err instanceof ZaloRejectedError) held.keepAliveRejections += 1;
      this.deps.logger.warn(
        {
          accountId: held.accountId,
          failures: held.keepAliveFailures,
          rejections: held.keepAliveRejections,
          error: errorMessage(err),
        },
        'zalo keep-alive failed',
      );
      if (held.keepAliveRejections >= this.deps.env.ZALO_MAX_SESSION_FAILURES) {
        await this.markExpired(held.accountId, held.ciphertext, errorMessage(err));
        await this.drop(held, 'keep-alive rejected');
        return;
      }
      // Back off 1, 2, 4… min, never longer than the normal interval.
      held.nextKeepAliveAt =
        this.now() +
        Math.min(
          RETRY_BASE_MS * 2 ** (held.keepAliveFailures - 1),
          this.deps.env.ZALO_KEEPALIVE_INTERVAL_MS,
        );
    }
  }

  /** Zalo may rotate cookies: store the new jar (guarded — never overwrite a newer login). */
  private async persistAfterKeepAlive(held: HeldAccount): Promise<void> {
    const credentials = held.session.credentials();
    const json = JSON.stringify(credentials);
    const lastSeenAt = new Date(this.now());
    if (json === held.credentialsJson) {
      await prisma.zaloAccount.updateMany({
        where: { id: held.accountId, credentials: held.ciphertext },
        data: { lastSeenAt },
      });
      return;
    }
    const ciphertext = this.deps.cipher.encrypt(credentials, held.vendorId);
    const { count } = await prisma.zaloAccount.updateMany({
      where: { id: held.accountId, status: 'ACTIVE', credentials: held.ciphertext },
      data: { credentials: ciphertext, lastSeenAt },
    });
    if (count === 1) {
      held.ciphertext = ciphertext;
      held.credentialsJson = json;
    }
  }

  /** ACTIVE → EXPIRED, only if the row still holds the credentials that failed. */
  private async markExpired(accountId: string, ciphertext: string, error: string): Promise<void> {
    const { count } = await prisma.zaloAccount.updateMany({
      where: { id: accountId, status: 'ACTIVE', credentials: ciphertext },
      data: { status: 'EXPIRED', lastError: error.slice(0, MAX_ERROR_LENGTH) },
    });
    if (count === 1) this.deps.logger.warn({ accountId, error }, 'zalo account expired');
  }

  private async drop(
    held: HeldAccount,
    reason: string,
    options: { release: boolean } = { release: true },
  ): Promise<void> {
    if (this.held.get(held.accountId) !== held) return;
    this.held.delete(held.accountId);
    held.session.close();
    if (options.release) await this.releaseLease(held.accountId);
    this.deps.logger.info({ accountId: held.accountId, reason }, 'zalo session dropped');
  }

  private async renewLease(accountId: string): Promise<boolean> {
    const result = await this.deps.redis.eval(
      RENEW_LUA,
      1,
      leaseKey(accountId),
      this.deps.instanceId,
      String(this.leaseTtlMs),
    );
    return result === 1;
  }

  private async releaseLease(accountId: string): Promise<void> {
    await this.deps.redis.eval(RELEASE_LUA, 1, leaseKey(accountId), this.deps.instanceId);
  }
}
