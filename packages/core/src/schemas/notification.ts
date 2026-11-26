import { z } from 'zod';
import { NotificationIdSchema, VendorIdSchema } from '../ids';
import { IsoDateTimeSchema } from './datetime';

/** In-app notification (`GET /v1/me/notifications`). `vendorId` is set for shop (CRM) messages. */
export const NotificationSchema = z.object({
  id: NotificationIdSchema,
  vendorId: VendorIdSchema.nullable(),
  title: z.string().max(200),
  body: z.string().max(2000),
  /** Storefront-relative path (e.g. `/shop/abc`), never an absolute URL. */
  linkPath: z
    .string()
    .max(500)
    .regex(/^\/(?!\/)[^\s]*$/)
    .nullable(),
  readAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Notification = z.infer<typeof NotificationSchema>;

export const UnreadCountSchema = z.object({ count: z.number().int().nonnegative() });
export type UnreadCount = z.infer<typeof UnreadCountSchema>;
