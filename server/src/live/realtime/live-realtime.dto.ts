import { MuteLiveUserSchema, SendLiveChatMessageSchema, SendLiveReactionSchema } from '@repo/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Request DTOs = the core schemas (Golden Rule #1); the global ZodValidationPipe parses them.
export class SendLiveChatMessageDto extends createZodDto(SendLiveChatMessageSchema) {}
export class SendLiveReactionDto extends createZodDto(SendLiveReactionSchema) {}
export class MuteLiveUserDto extends createZodDto(MuteLiveUserSchema) {}

/**
 * `GET /live-sessions/:id/messages?limit=` — server-local until it moves to `@repo/core`
 * (TODO: add `ListLiveChatMessagesQuerySchema` to core/schemas/live.ts).
 */
export const ListLiveChatMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export class ListLiveChatMessagesQueryDto extends createZodDto(ListLiveChatMessagesQuerySchema) {}
