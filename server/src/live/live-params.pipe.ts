import { Injectable, type PipeTransform } from '@nestjs/common';
import {
  DomainError,
  type ErrorCode,
  type LiveChatMessageId,
  LiveChatMessageIdSchema,
  type LiveSessionId,
  LiveSessionIdSchema,
  type ProductId,
  ProductIdSchema,
  type UserId,
  UserIdSchema,
} from '@repo/core';

/** `:id` route param. A malformed id cannot exist → `live.error.not-found` (not a 422). */
@Injectable()
export class LiveSessionIdPipe implements PipeTransform<string, LiveSessionId> {
  transform(value: string): LiveSessionId {
    return parseOr(LiveSessionIdSchema, value, 'live.error.not-found');
  }
}

/** `:productId` route param → `product.error.not-found` when malformed. */
@Injectable()
export class ProductIdPipe implements PipeTransform<string, ProductId> {
  transform(value: string): ProductId {
    return parseOr(ProductIdSchema, value, 'product.error.not-found');
  }
}

function parseOr<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: string,
  code: ErrorCode,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DomainError(code);
  return parsed.data;
}

/** `:messageId` route param (Redis Stream entry id) → `live.error.not-found` when malformed. */
@Injectable()
export class LiveChatMessageIdPipe implements PipeTransform<string, LiveChatMessageId> {
  transform(value: string): LiveChatMessageId {
    return parseOr(LiveChatMessageIdSchema, value, 'live.error.not-found');
  }
}

/** `:userId` route param → `common.error.validation-failed` (422) when malformed. */
@Injectable()
export class UserIdPipe implements PipeTransform<string, UserId> {
  transform(value: string): UserId {
    return parseOr(UserIdSchema, value, 'common.error.validation-failed');
  }
}
