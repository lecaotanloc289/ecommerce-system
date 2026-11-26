import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { ulid } from 'ulid';
import { LiveSessionStatus } from '@prisma/client';
import { prisma } from '../src/client.js';
import { SEED_IDS } from '../src/seed-ids.js';

const created: string[] = [];

function makeSession(
  status: LiveSessionStatus,
  idempotencyKey = ulid(),
  vendorId: string = SEED_IDS.vendorB,
) {
  const id = ulid();
  created.push(id);
  return prisma.liveSession.create({
    data: {
      id,
      vendorId,
      createdById: SEED_IDS.vendorBOwner,
      idempotencyKey,
      title: 'constraint test',
      status,
    },
  });
}

describe('live session DB invariants', () => {
  afterEach(async () => {
    await prisma.liveSession.deleteMany({ where: { id: { in: created } } }); // products cascade
    created.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects a second LIVE session for the same vendor', async () => {
    await makeSession(LiveSessionStatus.LIVE);
    await expect(makeSession(LiveSessionStatus.LIVE)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a LIVE and an ENDED session for the same vendor', async () => {
    await makeSession(LiveSessionStatus.LIVE);
    await expect(makeSession(LiveSessionStatus.ENDED)).resolves.toBeDefined();
  });

  it('allows LIVE sessions for different vendors', async () => {
    await makeSession(LiveSessionStatus.LIVE);
    await expect(
      makeSession(LiveSessionStatus.LIVE, ulid(), SEED_IDS.vendorA),
    ).resolves.toBeDefined();
  });

  it('rejects two pinned products in one session', async () => {
    const session = await makeSession(LiveSessionStatus.SCHEDULED);
    const now = new Date();
    await prisma.liveSessionProduct.create({
      data: {
        liveSessionId: session.id,
        productId: SEED_IDS.productA1,
        position: 0,
        pinnedAt: now,
      },
    });
    await expect(
      prisma.liveSessionProduct.create({
        data: {
          liveSessionId: session.id,
          productId: SEED_IDS.productA2,
          position: 1,
          pinnedAt: now,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // an unpinned one is fine
    await expect(
      prisma.liveSessionProduct.create({
        data: { liveSessionId: session.id, productId: SEED_IDS.productB1, position: 2 },
      }),
    ).resolves.toBeDefined();
  });

  it('enforces (vendorId, idempotencyKey) uniqueness', async () => {
    const key = ulid();
    await makeSession(LiveSessionStatus.SCHEDULED, key);
    await expect(makeSession(LiveSessionStatus.SCHEDULED, key)).rejects.toMatchObject({
      code: 'P2002',
    });
  });
});
