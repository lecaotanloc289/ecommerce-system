import { Injectable } from '@nestjs/common';
import {
  DomainError,
  NotificationSchema,
  type Notification,
  type PageQuery,
  type UnreadCount,
} from '@repo/core';
import { cursorPageArgs, toPage } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

interface NotificationRow {
  id: string;
  vendorId: string | null;
  title: string;
  body: string;
  linkPath: string | null;
  readAt: Date | null;
  createdAt: Date;
}

function toNotification(row: NotificationRow): Notification {
  return NotificationSchema.parse({
    id: row.id,
    vendorId: row.vendorId,
    title: row.title,
    body: row.body,
    linkPath: row.linkPath,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

/** In-app notifications of the signed-in user; every query is scoped by `userId` from the JWT. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    query: PageQuery,
  ): Promise<{ items: Notification[]; nextCursor: string | null }> {
    const args = cursorPageArgs(query);
    const rows = await this.prisma.client.notification.findMany({
      ...args,
      where: { userId, ...args.where },
    });
    const page = toPage(rows, query);
    return { items: page.items.map(toNotification), nextCursor: page.nextCursor };
  }

  async unreadCount(userId: string): Promise<UnreadCount> {
    const count = await this.prisma.client.notification.count({ where: { userId, readAt: null } });
    return { count };
  }

  /** Idempotent: an already-read notification keeps its first `readAt`. */
  async markRead(userId: string, id: string): Promise<Notification> {
    const db = this.prisma.client;
    await db.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    const row = await db.notification.findFirst({ where: { id, userId } });
    if (!row) throw new DomainError('notification.error.not-found');
    return toNotification(row);
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.client.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
