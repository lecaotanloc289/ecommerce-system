import { Injectable } from '@nestjs/common';
import { type ZaloMessageListQuery, type ZaloMessagePage, ZaloMessagePageSchema } from '@repo/core';
import { cursorPageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

/** The shop's automated-message log (newest first). */
@Injectable()
export class ZaloMessagesService {
  constructor(private readonly db: PrismaService) {}

  async list(vendorId: string, query: ZaloMessageListQuery): Promise<ZaloMessagePage> {
    const args = cursorPageArgs(query);
    const rows = await this.db.client.zaloMessage.findMany({
      ...args,
      where: {
        vendorId,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...args.where,
      },
      select: {
        id: true,
        subOrderId: true,
        event: true,
        status: true,
        scheduledAt: true,
        sentAt: true,
        attempts: true,
        skipReason: true,
        renderedBody: true,
        createdAt: true,
        subOrder: { select: { orderId: true } },
      },
    });
    const page = toPage(rows, query);
    return ZaloMessagePageSchema.parse({
      nextCursor: page.nextCursor,
      items: page.items.map((row) => ({
        id: row.id,
        orderId: row.subOrder.orderId,
        subOrderId: row.subOrderId,
        event: row.event,
        status: row.status,
        scheduledAt: row.scheduledAt.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
        attempts: row.attempts,
        skipReason: row.skipReason,
        renderedBody: row.renderedBody,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  }
}
