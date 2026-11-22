import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  VendorApplicationCreateSchema,
  VendorApplicationDetailSchema,
  VendorApplicationIdSchema,
  VendorApplicationListPageSchema,
  VendorApplicationListQuerySchema,
  VendorApplicationMeSchema,
  VendorApplicationReviewResultSchema,
  VendorApplicationSchema,
  VendorApproveSchema,
  VendorRejectSchema,
} from '@repo/core';

/** OpenAPI/request/response DTOs for the vendor-application controllers (schemas in `@repo/core`). */
export class VendorApplicationCreateDto extends createZodDto(VendorApplicationCreateSchema) {}
export class VendorApplicationDto extends createZodDto(VendorApplicationSchema) {}
export class VendorApplicationMeDto extends createZodDto(VendorApplicationMeSchema) {}
export class VendorApplicationListQueryDto extends createZodDto(VendorApplicationListQuerySchema) {}
export class VendorApplicationListPageDto extends createZodDto(VendorApplicationListPageSchema) {}
export class VendorApplicationDetailDto extends createZodDto(VendorApplicationDetailSchema) {}
export class VendorApplicationReviewResultDto extends createZodDto(
  VendorApplicationReviewResultSchema,
) {}
export class VendorApproveDto extends createZodDto(VendorApproveSchema) {}
export class VendorRejectDto extends createZodDto(VendorRejectSchema) {}
export class VendorApplicationParamsDto extends createZodDto(
  z.object({ id: VendorApplicationIdSchema }),
) {}
