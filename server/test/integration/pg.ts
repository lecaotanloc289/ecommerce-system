import { type ProductId, ProductIdSchema, Role } from '@repo/core';
import type Redis from 'ioredis';
import { ulid } from 'ulid';
import type { Env } from '../../src/config/env';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { testEnv } from '../helpers';

/**
 * Reusable Postgres + Redis harness for `*.pg.spec.ts` files (jest project `pg`).
 *
 * - Jest globalSetup (pg.global-setup.ts) starts Postgres 16 + Redis 7 containers once per run,
 *   applies the real migrations (`prisma migrate deploy`) to a template DB and clones one DB per
 *   worker; pg.worker-env.ts sets DATABASE_URL / REDIS_URL for the worker before `@repo/db` loads.
 * - In a test file: build the Nest app with the REAL PrismaModule + RedisModule and
 *   `{ provide: ENV, useValue: pgTestEnv() }`; call `resetDatabase` + `redis.flushdb()` in
 *   `beforeEach`. Files in one worker run sequentially, so truncation is safe.
 */

type Db = PrismaService['client'];

/** testEnv() pointed at this worker's Redis DB. */
export function pgTestEnv(overrides: Record<string, string> = {}): Env {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL not set — is this a *.pg.spec.ts file?');
  return testEnv({ REDIS_URL: redisUrl, ...overrides });
}

/** TRUNCATE every application table (keeps `_prisma_migrations`). */
export async function resetDatabase(db: Db): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}

export async function resetRedis(redis: Redis): Promise<void> {
  await redis.flushdb();
}

// ------------------------------------------------------------------ fixtures

export async function createUser(
  db: Db,
  roles: { role: Role; vendorId?: string }[] = [{ role: Role.CUSTOMER }],
): Promise<string> {
  const id = ulid();
  await db.user.create({
    data: {
      id,
      name: `User ${id.slice(-6)}`,
      roles: {
        create: roles.map(({ role, vendorId }) => ({
          id: ulid(),
          role,
          vendorId: vendorId ?? null,
        })),
      },
    },
  });
  return id;
}

export interface TestVendor {
  vendorId: string;
  ownerId: string;
}

/** Vendor + owner user (CUSTOMER + VENDOR_OWNER roles). */
export async function createVendor(
  db: Db,
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
): Promise<TestVendor> {
  const ownerId = await createUser(db);
  const vendorId = ulid();
  await db.vendor.create({
    data: {
      id: vendorId,
      ownerId,
      slug: `vendor-${vendorId.toLowerCase()}`,
      displayName: `Vendor ${vendorId.slice(-6)}`,
      status,
    },
  });
  await db.userRole.create({
    data: { id: ulid(), userId: ownerId, role: Role.VENDOR_OWNER, vendorId },
  });
  return { vendorId, ownerId };
}

export async function addVendorStaff(db: Db, vendorId: string): Promise<string> {
  return createUser(db, [{ role: Role.CUSTOMER }, { role: Role.VENDOR_STAFF, vendorId }]);
}

export async function createProduct(
  db: Db,
  vendorId: string,
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' = 'ACTIVE',
): Promise<ProductId> {
  const id = ProductIdSchema.parse(ulid());
  await db.product.create({ data: { id, vendorId, status, basePriceAmount: 100_000n } });
  return id;
}
