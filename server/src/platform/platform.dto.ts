import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  OrderIdSchema,
  PlatformOrderDetailSchema,
  PlatformOrderListQuerySchema,
  PlatformOrderPageSchema,
  PlatformProductBlockSchema,
  PlatformProductListQuerySchema,
  PlatformProductPageSchema,
  PlatformProductSchema,
  PlatformRoleGrantSchema,
  PlatformRoleSchema,
  PlatformSettingsSchema,
  PlatformSettingsUpdateSchema,
  PlatformUserListQuerySchema,
  PlatformUserPageSchema,
  PlatformUserSchema,
  PlatformVendorListQuerySchema,
  PlatformVendorPageSchema,
  PlatformVendorSchema,
  PlatformVendorSuspendSchema,
  ProductIdSchema,
  UserIdSchema,
  VendorIdSchema,
} from '@repo/core';

/** OpenAPI/request/response DTOs of the platform admin controllers (schemas live in `@repo/core`). */
export class PlatformSettingsDto extends createZodDto(PlatformSettingsSchema) {}
export class PlatformSettingsUpdateDto extends createZodDto(PlatformSettingsUpdateSchema) {}

export class PlatformVendorListQueryDto extends createZodDto(PlatformVendorListQuerySchema) {}
export class PlatformVendorPageDto extends createZodDto(PlatformVendorPageSchema) {}
export class PlatformVendorDto extends createZodDto(PlatformVendorSchema) {}
export class PlatformVendorSuspendDto extends createZodDto(PlatformVendorSuspendSchema) {}
export class PlatformVendorParamsDto extends createZodDto(z.object({ id: VendorIdSchema })) {}

export class PlatformProductListQueryDto extends createZodDto(PlatformProductListQuerySchema) {}
export class PlatformProductPageDto extends createZodDto(PlatformProductPageSchema) {}
export class PlatformProductDto extends createZodDto(PlatformProductSchema) {}
export class PlatformProductBlockDto extends createZodDto(PlatformProductBlockSchema) {}
export class PlatformProductParamsDto extends createZodDto(z.object({ id: ProductIdSchema })) {}

export class PlatformOrderListQueryDto extends createZodDto(PlatformOrderListQuerySchema) {}
export class PlatformOrderPageDto extends createZodDto(PlatformOrderPageSchema) {}
export class PlatformOrderDetailDto extends createZodDto(PlatformOrderDetailSchema) {}
export class PlatformOrderParamsDto extends createZodDto(z.object({ id: OrderIdSchema })) {}

export class PlatformUserListQueryDto extends createZodDto(PlatformUserListQuerySchema) {}
export class PlatformUserPageDto extends createZodDto(PlatformUserPageSchema) {}
export class PlatformUserDto extends createZodDto(PlatformUserSchema) {}
export class PlatformRoleGrantDto extends createZodDto(PlatformRoleGrantSchema) {}
export class PlatformUserParamsDto extends createZodDto(z.object({ id: UserIdSchema })) {}
export class PlatformUserRoleParamsDto extends createZodDto(
  z.object({ id: UserIdSchema, role: PlatformRoleSchema }),
) {}
