import { createZodDto } from 'nestjs-zod';
import {
  ZaloAccountResponseSchema,
  ZaloLoginParamsSchema,
  ZaloLoginStartSchema,
  ZaloLoginStateSchema,
  ZaloMessageListQuerySchema,
  ZaloMessagePageSchema,
  ZaloTemplateListSchema,
  ZaloTemplateParamsSchema,
  ZaloTemplateSchema,
  ZaloTemplateUpsertSchema,
} from '@repo/core';

/** OpenAPI/request/response DTOs for the vendor Zalo controller (schemas live in `@repo/core`). */
export class ZaloAccountResponseDto extends createZodDto(ZaloAccountResponseSchema) {}
export class ZaloLoginStartDto extends createZodDto(ZaloLoginStartSchema) {}
export class ZaloLoginParamsDto extends createZodDto(ZaloLoginParamsSchema) {}
/**
 * A discriminated union can't be a class base (TS2509), so this DTO is a value, not a class. Its
 * class is anonymous (`AugmentedZodDto`); the name is what OpenAPI uses as the component id.
 */
export const ZaloLoginStateDto = createZodDto(ZaloLoginStateSchema);
Object.defineProperty(ZaloLoginStateDto, 'name', { value: 'ZaloLoginStateDto' });
export class ZaloTemplateListDto extends createZodDto(ZaloTemplateListSchema) {}
export class ZaloTemplateParamsDto extends createZodDto(ZaloTemplateParamsSchema) {}
export class ZaloTemplateUpsertDto extends createZodDto(ZaloTemplateUpsertSchema) {}
export class ZaloTemplateDto extends createZodDto(ZaloTemplateSchema) {}
export class ZaloMessageListQueryDto extends createZodDto(ZaloMessageListQuerySchema) {}
export class ZaloMessagePageDto extends createZodDto(ZaloMessagePageSchema) {}
