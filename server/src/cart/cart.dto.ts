import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  CartItemSetSchema,
  CartMergeInputSchema,
  CartMergeResultSchema,
  CartQuerySchema,
  CartSchema,
  CartShippingOptionsSchema,
  ProductVariantIdSchema,
} from '@repo/core';

/** OpenAPI/request/response DTOs for the cart controller (schemas live in `@repo/core/schemas/cart`). */
export class CartDto extends createZodDto(CartSchema) {}
export class CartQueryDto extends createZodDto(CartQuerySchema) {}
export class CartItemSetDto extends createZodDto(CartItemSetSchema) {}
export class CartMergeInputDto extends createZodDto(CartMergeInputSchema) {}
export class CartMergeResultDto extends createZodDto(CartMergeResultSchema) {}
export class CartShippingOptionsDto extends createZodDto(CartShippingOptionsSchema) {}
export class CartVariantParamDto extends createZodDto(
  z.object({ variantId: ProductVariantIdSchema }),
) {}
