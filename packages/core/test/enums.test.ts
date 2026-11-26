import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as enums from '../src/enums';

// Drift guard: core enums must mirror packages/db/prisma/schema.prisma exactly.
// Reads the schema as text — core never imports @repo/db.
const schemaPath = fileURLToPath(new URL('../../db/prisma/schema.prisma', import.meta.url));

function parsePrismaEnums(source: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const match of source.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
    const [, name, body] = match;
    if (name === undefined || body === undefined) continue;
    const values = body
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(/\s+/)[0] ?? '');
    result.set(name, values);
  }
  return result;
}

const coreEnums: Record<string, z.ZodEnum> = {
  Role: enums.RoleSchema,
  OAuthProvider: enums.OAuthProviderSchema,
  Locale: enums.LocaleSchema,
  Currency: enums.CurrencySchema,
  VendorStatus: enums.VendorStatusSchema,
  ApplicationStatus: enums.ApplicationStatusSchema,
  ProductStatus: enums.ProductStatusSchema,
  OrderStatus: enums.OrderStatusSchema,
  SubOrderStatus: enums.SubOrderStatusSchema,
  PaymentProvider: enums.PaymentProviderSchema,
  PaymentStatus: enums.PaymentStatusSchema,
  LedgerAccount: enums.LedgerAccountSchema,
  LedgerEntryType: enums.LedgerEntryTypeSchema,
  CouponScope: enums.CouponScopeSchema,
  DiscountType: enums.DiscountTypeSchema,
  RefundStatus: enums.RefundStatusSchema,
  CrmMessageKind: enums.CrmMessageKindSchema,
  CrmChannel: enums.CrmChannelSchema,
  CrmAutomationKind: enums.CrmAutomationKindSchema,
  CrmCampaignStatus: enums.CrmCampaignStatusSchema,
  CrmMessageStatus: enums.CrmMessageStatusSchema,
  ConsentSource: enums.ConsentSourceSchema,
  ConsentAction: enums.ConsentActionSchema,
  ZaloAccountStatus: enums.ZaloAccountStatusSchema,
  ZaloMessageEvent: enums.ZaloMessageEventSchema,
  ZaloMessageStatus: enums.ZaloMessageStatusSchema,
};

describe('enums mirror Prisma', () => {
  const prismaEnums = parsePrismaEnums(readFileSync(schemaPath, 'utf8'));

  it('parses the Prisma schema', () => {
    expect(prismaEnums.size).toBeGreaterThan(0);
  });

  it('has a core mirror for every Prisma enum and nothing extra', () => {
    expect(Object.keys(coreEnums).sort()).toEqual([...prismaEnums.keys()].sort());
  });

  it.each(Object.entries(coreEnums))(
    '%s values match Prisma exactly (order included)',
    (name, schema) => {
      expect(schema.options).toEqual(prismaEnums.get(name));
    },
  );

  it('exposes value objects and validates', () => {
    expect(enums.Role.CUSTOMER).toBe('CUSTOMER');
    expect(enums.SubOrderStatus.AWAITING_PAYMENT).toBe('AWAITING_PAYMENT');
    expect(enums.CurrencySchema.safeParse('USD').success).toBe(true);
    expect(enums.CurrencySchema.safeParse('usd').success).toBe(false);
    expect(enums.LocaleSchema.safeParse('vi').success).toBe(false);
  });
});
