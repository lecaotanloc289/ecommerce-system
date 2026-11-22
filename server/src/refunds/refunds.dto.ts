import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  RefundCreateSchema,
  RefundListQuerySchema,
  RefundPageSchema,
  RefundSchema,
  SubOrderIdSchema,
} from '@repo/core';

/** OpenAPI/request/response DTOs for the platform refunds controller (schemas in `@repo/core`). */
export class RefundCreateDto extends createZodDto(RefundCreateSchema) {}
export class RefundDto extends createZodDto(RefundSchema) {}
export class RefundListQueryDto extends createZodDto(RefundListQuerySchema) {}
export class RefundPageDto extends createZodDto(RefundPageSchema) {}
export class SubOrderParamsDto extends createZodDto(z.object({ id: SubOrderIdSchema })) {}
