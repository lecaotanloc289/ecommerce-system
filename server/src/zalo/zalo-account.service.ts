import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  ZALO_LOGIN_QUEUE_KEY,
  ZALO_LOGIN_TTL_SECONDS,
  type ZaloAccount,
  type ZaloAccountResponse,
  type ZaloLoginRecord,
  ZaloLoginRecordSchema,
  type ZaloLoginStart,
  ZaloLoginStartSchema,
  type ZaloLoginState,
  zaloLoginKey,
} from '@repo/core';
import type Redis from 'ioredis';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { assertVendorOwner } from './vendor-access';

interface AccountRow {
  status: ZaloAccount['status'];
  displayName: string | null;
  avatarUrl: string | null;
  lastLoginAt: Date | null;
  lastSeenAt: Date | null;
}

const ACCOUNT_SELECT = {
  status: true,
  displayName: true,
  avatarUrl: true,
  lastLoginAt: true,
  lastSeenAt: true,
} as const;

function toAccount(row: AccountRow): ZaloAccount {
  return {
    status: row.status,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}

/**
 * The shop's Zalo account and its QR login. The API never talks to Zalo: a login request is a
 * Redis record + queue entry that workers/zalo picks up (contract in `@repo/core` schemas/zalo).
 * Credentials never leave the worker; this service only reads the public columns.
 */
@Injectable()
export class ZaloAccountService {
  constructor(
    private readonly db: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async get(vendorId: string): Promise<ZaloAccountResponse> {
    const row = await this.db.client.zaloAccount.findUnique({
      where: { vendorId },
      select: ACCOUNT_SELECT,
    });
    return { account: row ? toAccount(row) : null };
  }

  /** Queues a QR login for workers/zalo; the client polls `getLoginState` with the returned id. */
  async startLogin(vendorId: string, userId: string): Promise<ZaloLoginStart> {
    await assertVendorOwner(this.db, vendorId, userId);
    const loginId = ulid();
    const record: ZaloLoginRecord = ZaloLoginRecordSchema.parse({
      vendorId,
      requestedById: userId,
      state: { state: 'PENDING' },
    });
    const results = await this.redis
      .multi()
      .set(zaloLoginKey(loginId), JSON.stringify(record), 'EX', ZALO_LOGIN_TTL_SECONDS)
      .lpush(ZALO_LOGIN_QUEUE_KEY, loginId)
      .exec();
    const failed = results?.find(([err]) => err !== null);
    if (!results || failed) {
      throw new Error('zalo: failed to queue the login request', { cause: failed?.[0] });
    }
    return ZaloLoginStartSchema.parse({ loginId });
  }

  /**
   * Latest state of the caller's login request; unknown / expired / another vendor's or another
   * user's → 404. The QR is a login capability, so only the user who requested it may read it (JWT
   * roles are not per vendor, so the vendor match alone is not enough).
   */
  async getLoginState(vendorId: string, userId: string, loginId: string): Promise<ZaloLoginState> {
    const raw = await this.redis.get(zaloLoginKey(loginId));
    if (raw === null) throw new DomainError('zalo.error.login-not-found');
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new DomainError('zalo.error.login-not-found');
    }
    const parsed = ZaloLoginRecordSchema.safeParse(json);
    if (
      !parsed.success ||
      parsed.data.vendorId !== vendorId ||
      parsed.data.requestedById !== userId
    ) {
      throw new DomainError('zalo.error.login-not-found');
    }
    return parsed.data.state;
  }

  /**
   * Wipes the session (credentials + uid) and marks the account DISCONNECTED. workers/zalo drops
   * the live session on its next account sync; pending messages are then skipped.
   */
  async disconnect(vendorId: string, userId: string): Promise<ZaloAccountResponse> {
    await assertVendorOwner(this.db, vendorId, userId);
    const updated = await this.db.client.zaloAccount.updateMany({
      where: { vendorId, status: { not: 'DISCONNECTED' } },
      data: { status: 'DISCONNECTED', credentials: null, zaloUid: null, lastError: null },
    });
    if (updated.count === 0) throw new DomainError('zalo.error.account-not-connected');
    return this.get(vendorId);
  }
}
