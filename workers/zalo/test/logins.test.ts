import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ZALO_LOGIN_QUEUE_KEY,
  ZaloLoginRecordSchema,
  zaloLoginKey,
  type ZaloLoginState,
} from '@repo/core';
import { prisma } from '@repo/db';
import { AccountManager } from '../src/accounts.js';
import { QrLoginProcessor } from '../src/logins.js';
import { FakeGateway, FakeSession, fakeCredentials } from './fake-gateway.js';
import {
  cipher,
  logger,
  makeAccount,
  makeShop,
  newRedis,
  resetAll,
  testEnv,
  ulid,
} from './fixtures.js';

let redis: Redis;
let blocking: Redis;

beforeAll(() => {
  redis = newRedis();
  blocking = newRedis();
});
afterAll(async () => {
  await redis.quit();
  blocking.disconnect();
});
beforeEach(async () => {
  await resetAll(redis);
});

function setup(gateway: FakeGateway) {
  const accounts = new AccountManager({
    redis,
    gateway,
    cipher,
    logger,
    env: testEnv,
    instanceId: 'replica-1',
  });
  const processor = new QrLoginProcessor({
    redis,
    blockingRedis: blocking,
    gateway,
    accounts,
    logger,
    env: testEnv,
  });
  return { accounts, processor };
}

async function requestLogin(vendorId: string, requestedById: string): Promise<string> {
  const loginId = ulid();
  await redis.set(
    zaloLoginKey(loginId),
    JSON.stringify({ vendorId, requestedById, state: { state: 'PENDING' } }),
    'EX',
    600,
  );
  return loginId;
}

async function stateOf(loginId: string): Promise<ZaloLoginState | undefined> {
  const raw = await redis.get(zaloLoginKey(loginId));
  return raw === null ? undefined : ZaloLoginRecordSchema.parse(JSON.parse(raw)).state;
}

describe('QrLoginProcessor.handle', () => {
  it('stores the scanned account as ACTIVE (encrypted) and reports SUCCESS', async () => {
    const { vendor, owner } = await makeShop();
    const gateway = new FakeGateway();
    gateway.qr = {
      outcome: 'success',
      session: new FakeSession('uid-1', fakeCredentials('qr'), 'Shop Zalo'),
    };
    const { accounts, processor } = setup(gateway);
    const loginId = await requestLogin(vendor.id, owner.id);

    await processor.handle(loginId, new AbortController().signal);

    expect(await stateOf(loginId)).toEqual({ state: 'SUCCESS', displayName: 'Shop Zalo' });
    expect(await redis.ttl(zaloLoginKey(loginId))).toBeGreaterThan(0); // KEEPTTL
    const row = await prisma.zaloAccount.findUniqueOrThrow({ where: { vendorId: vendor.id } });
    expect(row).toMatchObject({ status: 'ACTIVE', zaloUid: 'uid-1', displayName: 'Shop Zalo' });
    expect(row.credentials).not.toContain('cookie-qr');
    expect(cipher.decrypt(row.credentials ?? '', vendor.id).imei).toBe('imei-qr');
    expect(accounts.heldAccounts().map((h) => h.vendorId)).toEqual([vendor.id]);
  });

  it.each([
    ['expired', { state: 'EXPIRED' }],
    ['declined', { state: 'DECLINED' }],
    ['aborted', { state: 'FAILED', reason: 'login-failed' }],
  ] as const)('QR %s → %j, no account', async (reason, expected) => {
    const { vendor, owner } = await makeShop();
    const gateway = new FakeGateway();
    gateway.qr = { outcome: 'end', reason };
    const loginId = await requestLogin(vendor.id, owner.id);

    await setup(gateway).processor.handle(loginId, new AbortController().signal);

    expect(await stateOf(loginId)).toEqual(expected);
    expect(await prisma.zaloAccount.count()).toBe(0);
  });

  it('reports already-linked when the Zalo account belongs to another shop', async () => {
    const a = await makeShop('A');
    const b = await makeShop('B');
    await makeAccount({
      vendorId: a.vendor.id,
      credentials: fakeCredentials('a'),
      zaloUid: 'uid-shared',
    });
    const session = new FakeSession('uid-shared', fakeCredentials('b'));
    const gateway = new FakeGateway();
    gateway.qr = { outcome: 'success', session };
    const loginId = await requestLogin(b.vendor.id, b.owner.id);

    await setup(gateway).processor.handle(loginId, new AbortController().signal);

    expect(await stateOf(loginId)).toEqual({ state: 'FAILED', reason: 'already-linked' });
    expect(session.closed).toBe(true);
  });

  it('ignores missing, malformed and already-handled requests', async () => {
    const { vendor, owner } = await makeShop();
    const gateway = new FakeGateway();
    gateway.qr = { outcome: 'success', session: new FakeSession('uid-1', fakeCredentials('qr')) };
    const { processor } = setup(gateway);
    const signal = new AbortController().signal;

    await processor.handle('not-a-ulid', signal);
    await processor.handle(ulid(), signal); // no record
    const done = await requestLogin(vendor.id, owner.id);
    await redis.set(
      zaloLoginKey(done),
      JSON.stringify({ vendorId: vendor.id, requestedById: owner.id, state: { state: 'EXPIRED' } }),
    );
    await processor.handle(done, signal);

    expect(await stateOf(done)).toEqual({ state: 'EXPIRED' });
    expect(await prisma.zaloAccount.count()).toBe(0);
  });
});

describe('QrLoginProcessor loop', () => {
  it('pops queued login ids and processes them', async () => {
    const { vendor, owner } = await makeShop();
    const gateway = new FakeGateway();
    gateway.qr = { outcome: 'success', session: new FakeSession('uid-1', fakeCredentials('qr')) };
    const { processor } = setup(gateway);
    const loginId = await requestLogin(vendor.id, owner.id);
    await redis.lpush(ZALO_LOGIN_QUEUE_KEY, loginId);

    processor.start();
    try {
      await expect
        .poll(() => stateOf(loginId), { timeout: 5_000 })
        .toMatchObject({ state: 'SUCCESS' });
    } finally {
      await processor.stop();
    }
    expect(await redis.llen(ZALO_LOGIN_QUEUE_KEY)).toBe(0);
  });
});
