import { Injectable } from '@nestjs/common';
import {
  type Address,
  type AddressInput,
  AddressSchema,
  type AddressUpdate,
  DomainError,
} from '@repo/core';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Parameters<Parameters<PrismaService['client']['$transaction']>[0]>[0];

const SELECT = {
  id: true,
  recipientName: true,
  phone: true,
  line1: true,
  line2: true,
  ward: true,
  district: true,
  city: true,
  country: true,
  isDefault: true,
} as const;

/**
 * Customer address book. Every query is scoped by `userId` from the JWT (another user's address
 * is 404). Invariant: a user with >= 1 address has exactly one default. Each mutation runs in a
 * `$transaction` that first locks the user's row (`FOR UPDATE`), serializing concurrent address
 * writes per user — this also covers two simultaneous first-address creates, where there are no
 * address rows yet to lock.
 */
@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<Address[]> {
    const rows = await this.prisma.client.address.findMany({
      where: { userId },
      select: SELECT,
      orderBy: { id: 'desc' },
    });
    // Default first, then newest (sort is stable).
    return rows
      .map((r) => AddressSchema.parse(r))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  create(userId: string, input: AddressInput): Promise<Address> {
    return this.prisma.client.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const existing = await tx.address.count({ where: { userId } });
      const isDefault = input.isDefault || existing === 0;
      if (isDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      const row = await tx.address.create({
        data: {
          id: ulid(),
          userId,
          recipientName: input.recipientName,
          phone: input.phone,
          line1: input.line1,
          line2: input.line2 ?? null,
          ward: input.ward,
          district: input.district,
          city: input.city,
          country: input.country,
          isDefault,
        },
        select: SELECT,
      });
      return AddressSchema.parse(row);
    });
  }

  update(userId: string, id: string, patch: AddressUpdate): Promise<Address> {
    return this.prisma.client.$transaction(async (tx) => {
      await lockUser(tx, userId);
      await requireOwned(tx, userId, id);
      const row = await tx.address.update({
        where: { id },
        data: {
          ...(patch.recipientName !== undefined && { recipientName: patch.recipientName }),
          ...(patch.phone !== undefined && { phone: patch.phone }),
          ...(patch.line1 !== undefined && { line1: patch.line1 }),
          ...(patch.line2 !== undefined && { line2: patch.line2 }),
          ...(patch.ward !== undefined && { ward: patch.ward }),
          ...(patch.district !== undefined && { district: patch.district }),
          ...(patch.city !== undefined && { city: patch.city }),
          ...(patch.country !== undefined && { country: patch.country }),
        },
        select: SELECT,
      });
      return AddressSchema.parse(row);
    });
  }

  setDefault(userId: string, id: string): Promise<Address> {
    return this.prisma.client.$transaction(async (tx) => {
      await lockUser(tx, userId);
      await requireOwned(tx, userId, id);
      await tx.address.updateMany({
        where: { userId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
      const row = await tx.address.update({
        where: { id },
        data: { isDefault: true },
        select: SELECT,
      });
      return AddressSchema.parse(row);
    });
  }

  remove(userId: string, id: string): Promise<void> {
    return this.prisma.client.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const address = await requireOwned(tx, userId, id);
      await tx.address.delete({ where: { id } });
      if (!address.isDefault) return;
      // The default went away: promote the newest remaining address (ULIDs sort by creation).
      const next = await tx.address.findFirst({
        where: { userId },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    });
  }
}

async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
}

async function requireOwned(tx: Tx, userId: string, id: string): Promise<{ isDefault: boolean }> {
  const found = await tx.address.findFirst({ where: { id, userId }, select: { isDefault: true } });
  if (!found) throw new DomainError('address.error.not-found');
  return found;
}
