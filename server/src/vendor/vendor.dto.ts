import {
  ProductIdSchema,
  ProductUpsertSchema,
  ProductVariantIdSchema,
  ShippingMethodIdSchema,
  ShippingMethodInputSchema,
  ShippingMethodSchema,
  VariantStockUpdateSchema,
  VendorProductPageSchema,
  VendorProductQuerySchema,
  VendorProductSchema,
  VendorProductVariantSchema,
} from '@repo/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** DTOs of the vendor catalog controllers (schemas live in `@repo/core/schemas/{product-admin,shipping-method}`). */
export class VendorProductDto extends createZodDto(VendorProductSchema) {}
export class VendorProductPageDto extends createZodDto(VendorProductPageSchema) {}
export class VendorProductQueryDto extends createZodDto(VendorProductQuerySchema) {}
export class ProductUpsertDto extends createZodDto(ProductUpsertSchema) {}
export class VendorProductParamsDto extends createZodDto(z.object({ id: ProductIdSchema })) {}
export class VendorVariantParamsDto extends createZodDto(
  z.object({ id: ProductVariantIdSchema }),
) {}
export class VariantStockUpdateDto extends createZodDto(VariantStockUpdateSchema) {}
export class VendorProductVariantDto extends createZodDto(VendorProductVariantSchema) {}
export class ShippingMethodDto extends createZodDto(ShippingMethodSchema) {}
export class ShippingMethodListDto extends createZodDto(z.array(ShippingMethodSchema)) {}
export class ShippingMethodInputDto extends createZodDto(ShippingMethodInputSchema) {}
export class ShippingMethodParamsDto extends createZodDto(
  z.object({ id: ShippingMethodIdSchema }),
) {}
