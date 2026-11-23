import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@repo/db';
import { AccountManager, leaseKey } from '../src/accounts.js';
import { ZaloRejectedError } from '../src/gateway.js';
import { FakeGateway, FakeSession, fakeCredentials } from './fake-gateway.js';
import { cipher, logger, makeAccount, makeShop, newRedis, resetAll, testEnv } from './fixtures.js';

let redis: Redis;
let clock: number;

function manager(gateway: FakeGateway, instanceId = 'replica-1') {
  return new AccountManager({
    redis,
    gateway,
    cipher,
    logger,
    env: testEnv,
    instanceId,
    now: () => clock,
  });
}

beforeAll(() => {
  redis = newRedis();
});
afterAll(async () => {
  await redis.quit();
});
beforeEach(async () => {
  await resetAll(redis);
  clock = Date.now();
});

describe('AccountManager.sync', () => {
  it('restores an ACTIVE account from its decrypted credentials and takes the lease', async () => {
    const { vendor } = await makeShop();
    const creds = fakeCredentials('a');
    const account = await makeAccount({ vendorId: vendor.id, credentials: creds });
    const gateway = new FakeGateway();
    gateway.sessions.set(creds.imei, new FakeSession('uid-a', creds));

    const m = manager(gateway);
    await m.sync();

    expect(gateway.logins).toEqual([creds]);
    expect(m.heldAccounts().map((h) => h.vendorId)).toEqual([vendor.id]);
    expect(await redis.get(leaseKey(account.id))).toBe('replica-1');
  });

  it('never holds one account on two replicas', async () => {
    const { vendor } = await makeShop();
    const creds = fakeCredentials('a');
    await makeAccount({ vendorId: vendor.id, credentials: creds });
    const gateway = new FakeGateway();
    gateway.sessions.set(creds.imei, new FakeSession('uid-a', creds));

    const first = manager(gateway, 'replica-1');
    const second = manager(gateway, 'replica-2');
    await first.sync();
    await second.sync();

    expect(first.heldAccounts()).toHaveLength(1);
    expect(second.heldAccounts()).toHaveLength(0);
    expect(gateway.logins).toHaveLength(1);
  });

  it('drops a disconnected account and releases its lease', async () => {
    const { vendor } = await makeShop();
    const creds = fakeCredentials('a');
    const account = await makeAccount({ vendorId: vendor.id, credentials: creds });
    const session = new FakeSession('uid-a', creds);
    const gateway = new FakeGateway();
    gateway.sessions.set(creds.imei, session);
    const m = manager(gateway);
    await m.sync();

    await prisma.zaloAccount.update({
      where: { id: account.id },
      data: { status: 'DISCONNECTED', credentials: null, zaloUid: null },
    });
    await m.sync();

    expect(m.heldAccounts()).toHaveLength(0);
    expect(session.closed).toBe(true);
    expect(await redis.get(leaseKey(account.id))).toBeNull();
  });

  it('backs off failed restores and marks the account EXPIRED after the max failures', async () => {
    const { vendor } = await makeShop();
    const account = await makeAccount({ vendorId: vendor.id, credentials: fakeCredentials('a') });
    const gateway = new FakeGateway(); // no session for this imei → login rejects
    const m = manager(gateway);

    await m.sync();
    await m.sync(); // inside the backoff window: no second attempt
    expect(gateway.logins).toHaveLength(1);
    expect(await redis.get(leaseKey(account.id))).toBeNull();

    clock += 60_000;
    await m.sync();
    clock += 120_000;
    await m.sync();
    expect(gateway.logins).toHaveLength(3);

    const row = await prisma.zaloAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.status).toBe('EXPIRED');
    expect(row.lastError).toContain('session rejected by Zalo');
  });

  it('expires immediately when the stored credentials cannot be decrypted', async () => {
    const { vendor } = await makeShop();
    const account = await makeAccount({ vendorId: vendor.id, credentials: fakeCredentials('a') });
    await prisma.zaloAccount.update({
      where: { id: account.id },
      data: { credentials: 'v1.bad.bad.bad' },
    });

    const gateway = new FakeGateway();
    await manager(gateway).sync();

    expect(gateway.logins).toHaveLength(0);
    const row = await prisma.zaloAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.status).toBe('EXPIRED');
    expect(row.lastError).toContain('credentials unreadable');
  });
});

describe('keep-alive', () => {
  it('persists rotated cookies (re-encrypted) and refreshes lastSeenAt', async () => {
    const { vendor } = await makeShop();
    const creds = fakeCredentials('a');
    const account = await makeAccount({ vendorId: vendor.id, credentials: creds });
    const session = new FakeSession('uid-a', creds);
    const gateway = new FakeGateway();
    gateway.sessions.set(creds.imei, session);
    const m = manager(gateway);
    await m.sync();

    session.rotateCookie('rotated');
    clock += testEnv.ZALO_KEEPALIVE_INTERVAL_MS;
    await m.sync();

    const row = await prisma.zaloAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(cipher.decrypt(row.credentials ?? '', vendor.id).cookie[0]?.value).toBe('rotated');
    expect(row.lastSeenAt).not.toBeNull();
    // Still held: the guard moved to the new ciphertext.
    await m.sync();
    expect(m.heldAccounts()).toHaveLength(1);
  });

  it('marks EXPIRED and drops the session after repeated keep-alive failures', async () => {
    const { vendor } = await makeShop();
    const creds = fakeCredentials('a');
    const account = await makeAccount({ vendorId: vendor.id, credentials: creds });
    const session = new FakeSession('uid-a', creds);
    const gateway = new FakeGateway();
    gateway.sessions.set(creds.imei, session);
    const m = manager(gateway);
    await m.sync();

    session.keepAliveError = new ZaloRejectedError('logged out');
    clock += testEnv.ZALO_KEEPALIVE_INTERVAL_MS;
    await m.sync(); // rejection 1 → retry in 1 min
    await m.sync(); // not due yet
    clock += 60_000;
    await m.sync(); // rejection 2 → retry in 2 min
    expect(m.heldAccounts()).toHaveLength(1);
    clock += 120_000;
    await m.sync(); // rejection 3 → EXPIRED

    expect(m.heldAccounts()).toHaveLength(0);
    const row = await prisma.zaloAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(row.status).toBe('EXPIRED');
    expect(row.lastError).toContain('logged out');
  });
});

describe('network failures never expire an account', () => {
  it('keeps retrying restores and keep-alives that fail without a Zalo answer', async () => {
    const { vendor } = await makeShop();
    const creds = fakeCredentials('a');
    const account = await makeAccount({ vendorId: vendor.id, credentials: creds });
    const gateway = new FakeGateway();
    gateway.loginError = new Error('ECONNRESET');
    const m = manager(gateway);
    for (let i = 0; i < 6; i += 1) {
      await m.sync();
      clock += 600_000;
    }
    expect(gateway.logins).toHaveLength(6);
    expect((await prisma.zaloAccount.findUniqueOrThrow({ where: { id: account.id } })).status).toBe(
      'ACTIVE',
    );

    gateway.loginError = undefined;
    const session = new FakeSession('uid-a', creds);
    gateway.sessions.set(creds.imei, session);
    await m.sync();
    expect(m.heldAccounts()).toHaveLength(1);

    session.keepAliveError = new Error('ETIMEDOUT');
    for (let i = 0; i < 6; i += 1) {
      clock += testEnv.ZALO_KEEPALIVE_INTERVAL_MS;
      await m.sync();
    }
    expect(m.heldAccounts()).toHaveLength(1);
    expect((await prisma.zaloAccount.findUniqueOrThrow({ where: { id: account.id } })).status).toBe(
      'ACTIVE',
    );
  });
});

describe('AccountManager.connect', () => {
  it('stores an encrypted ACTIVE account, takes over the lease and drops the stale copy elsewhere', async () => {
    const { vendor } = await makeShop();
    const old = fakeCredentials('old');
    const account = await makeAccount({ vendorId: vendor.id, credentials: old, status: 'EXPIRED' });
    await redis.set(leaseKey(account.id), 'replica-2');

    const fresh = new FakeSession('uid-new', fakeCredentials('new'), 'Shop Zalo mới');
    const m = manager(new FakeGateway());
    expect(await m.connect(vendor.id, fresh)).toBe('connected');

    const row = await prisma.zaloAccount.findUniqueOrThrow({ where: { vendorId: vendor.id } });
    expect(row).toMatchObject({
      id: account.id,
      status: 'ACTIVE',
      zaloUid: 'uid-new',
      displayName: 'Shop Zalo mới',
      lastError: null,
    });
    expect(cipher.decrypt(row.credentials ?? '', vendor.id).imei).toBe('imei-new');
    expect(await redis.get(leaseKey(account.id))).toBe('replica-1');
    expect(m.heldAccounts()).toHaveLength(1);
  });

  it('refuses a Zalo account already linked to another shop', async () => {
    const a = await makeShop('A');
    const b = await makeShop('B');
    await makeAccount({
      vendorId: a.vendor.id,
      credentials: fakeCredentials('a'),
      zaloUid: 'uid-shared',
    });

    const m = manager(new FakeGateway());
    const result = await m.connect(
      b.vendor.id,
      new FakeSession('uid-shared', fakeCredentials('b')),
    );

    expect(result).toBe('already-linked');
    expect(await prisma.zaloAccount.findUnique({ where: { vendorId: b.vendor.id } })).toBeNull();
    expect(m.heldAccounts()).toHaveLength(0);
  });
});
