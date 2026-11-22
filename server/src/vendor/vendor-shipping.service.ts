import { Injectable } from '@nestjs/common';
import {
  DomainError,
  type ShippingMethod,
  type ShippingMethodInput,
  ShippingMethodSchema,
} from '@repo/core';
import { type Prisma, toDbAmount, toMoney } from '@repo/db';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { assertCurrencySupported, assertVendorActive, supportedCurrencies } from './vendor-scope';

type MethodRow = Prisma.ShippingMethodGetPayload<Record<string, never>>;

function toShippingMethod(row: MethodRow): ShippingMethod {
  return ShippingMethodSchema.parse({
    id: row.id,
    vendorId: row.vendorId,
    name: row.name,
    price: toMoney(row.priceAmount, row.priceCurrency),
    estDays: row.estDays,
    isActive: row.isActive,
  });
}

/** A vendor's shipping methods; scoped by the `vendorId` from `req.user`, never the client. */
@Injectable()
export class VendorShippingService {
  constructor(private readonly prisma: PrismaService) {}

  async list(vendorId: string): Promise<ShippingMethod[]> {
    const rows = await this.prisma.client.shippingMethod.findMany({
      where: { vendorId },
      orderBy: { id: 'asc' },
    });
    return rows.map(toShippingMethod);
  }

  create(vendorId: string, body: ShippingMethodInput): Promise<ShippingMethod> {
    return this.prisma.client.$transaction(async (tx) => {
      await assertVendorActive(tx, vendorId);
      assertCurrencySupported(await supportedCurrencies(tx), body.price.currency, 'price');
      const row = await tx.shippingMethod.create({
        data: { id: ulid(), vendorId, ...this.data(body) },
      });
      return toShippingMethod(row);
    });
  }

  update(vendorId: string, id: string, body: ShippingMethodInput): Promise<ShippingMethod> {
    return this.prisma.client.$transaction(async (tx) => {
      await assertVendorActive(tx, vendorId);
      assertCurrencySupported(await supportedCurrencies(tx), body.price.currency, 'price');
      const { count } = await tx.shippingMethod.updateMany({
        where: { id, vendorId },
        data: this.data(body),
      });
      if (count === 0) throw new DomainError('common.error.not-found', { id });
      return toShippingMethod(await tx.shippingMethod.findUniqueOrThrow({ where: { id } }));
    });
  }

  /** Existing orders keep their snapshot; only new checkouts stop offering the method. */
  deactivate(vendorId: string, id: string): Promise<ShippingMethod> {
    return this.prisma.client.$transaction(async (tx) => {
      await assertVendorActive(tx, vendorId);
      const { count } = await tx.shippingMethod.updateMany({
        where: { id, vendorId },
        data: { isActive: false },
      });
      if (count === 0) throw new DomainError('common.error.not-found', { id });
      return toShippingMethod(await tx.shippingMethod.findUniqueOrThrow({ where: { id } }));
    });
  }

  private data(body: ShippingMethodInput) {
    return {
      name: body.name,
      priceAmount: toDbAmount(body.price),
      priceCurrency: body.price.currency,
      estDays: body.estDays,
      isActive: body.isActive,
    };
  }
}
