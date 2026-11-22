import {
  LedgerEntryPageSchema,
  PageQuerySchema,
  SubOrderIdSchema,
  SubOrderShipSchema,
  VendorSubOrderPageSchema,
  VendorSubOrderQuerySchema,
  VendorSubOrderSchema,
  VendorWalletSchema,
} from '@repo/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** DTOs of the vendor fulfilment + wallet controllers (schemas live in `@repo/core`). */
export class VendorSubOrderDto extends createZodDto(VendorSubOrderSchema) {}
export class VendorSubOrderPageDto extends createZodDto(VendorSubOrderPageSchema) {}
export class VendorSubOrderQueryDto extends createZodDto(VendorSubOrderQuerySchema) {}
export class VendorSubOrderParamsDto extends createZodDto(z.object({ id: SubOrderIdSchema })) {}
export class SubOrderShipDto extends createZodDto(SubOrderShipSchema) {}
export class VendorWalletDto extends createZodDto(VendorWalletSchema) {}
export class LedgerEntryPageDto extends createZodDto(LedgerEntryPageSchema) {}
export class LedgerPageQueryDto extends createZodDto(PageQuerySchema) {}
