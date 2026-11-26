import {
  NotificationIdSchema,
  NotificationSchema,
  PageQuerySchema,
  PageSchema,
  UnreadCountSchema,
} from '@repo/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class NotificationDto extends createZodDto(NotificationSchema) {}
export class NotificationPageDto extends createZodDto(PageSchema(NotificationSchema)) {}
export class NotificationPageQueryDto extends createZodDto(PageQuerySchema) {}
export class UnreadCountDto extends createZodDto(UnreadCountSchema) {}
export class NotificationParamsDto extends createZodDto(z.object({ id: NotificationIdSchema })) {}
