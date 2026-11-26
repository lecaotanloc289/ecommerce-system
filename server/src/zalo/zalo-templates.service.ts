import { Injectable } from '@nestjs/common';
import {
  DomainError,
  findUnknownZaloPlaceholder,
  ZALO_TEMPLATE_PLACEHOLDERS,
  type ZaloMessageEvent,
  ZaloMessageEventSchema,
  type ZaloTemplate,
  type ZaloTemplateList,
  type ZaloTemplateUpsert,
} from '@repo/core';
import { ulid } from 'ulid';
import { PrismaService } from '../prisma/prisma.service';
import { assertVendorActive } from './vendor-access';

interface TemplateRow {
  event: ZaloMessageEvent;
  isEnabled: boolean;
  body: string;
  delayMinutes: number;
  updatedAt: Date;
}

function toTemplate(row: TemplateRow): ZaloTemplate {
  return {
    event: row.event,
    isEnabled: row.isEnabled,
    body: row.body,
    delayMinutes: row.delayMinutes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Vendor-authored message text per ZaloMessageEvent. No row = disabled. */
@Injectable()
export class ZaloTemplatesService {
  constructor(private readonly db: PrismaService) {}

  async list(vendorId: string): Promise<ZaloTemplateList> {
    const rows = await this.db.client.zaloMessageTemplate.findMany({ where: { vendorId } });
    const byEvent = new Map(rows.map((row) => [row.event, row]));
    return {
      items: ZaloMessageEventSchema.options.map((event) => {
        const row = byEvent.get(event);
        return row
          ? toTemplate(row)
          : { event, isEnabled: false, body: null, delayMinutes: 0, updatedAt: null };
      }),
      placeholders: [...ZALO_TEMPLATE_PLACEHOLDERS],
    };
  }

  /** Creates or replaces one event's template. `delayMinutes` is kept only for AFTER_DELIVERY. */
  async upsert(
    vendorId: string,
    event: ZaloMessageEvent,
    input: ZaloTemplateUpsert,
  ): Promise<ZaloTemplate> {
    const unknown = findUnknownZaloPlaceholder(input.body);
    if (unknown !== null) {
      throw new DomainError('zalo.error.unknown-placeholder', { placeholder: unknown });
    }
    await assertVendorActive(this.db, vendorId);
    const data = {
      isEnabled: input.isEnabled,
      body: input.body,
      delayMinutes: event === 'AFTER_DELIVERY' ? input.delayMinutes : 0,
    };
    const row = await this.db.client.zaloMessageTemplate.upsert({
      where: { vendorId_event: { vendorId, event } },
      create: { id: ulid(), vendorId, event, ...data },
      update: data,
    });
    return toTemplate(row);
  }
}
