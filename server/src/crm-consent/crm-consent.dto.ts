import {
  UnsubscribeSchema,
  UpdateVendorPreferenceSchema,
  VendorIdSchema,
  VendorPreferenceSchema,
} from '@repo/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export class VendorPreferenceDto extends createZodDto(VendorPreferenceSchema) {}
export class VendorPreferenceListDto extends createZodDto(z.array(VendorPreferenceSchema)) {}
export class UpdateVendorPreferenceDto extends createZodDto(UpdateVendorPreferenceSchema) {}
export class VendorPreferenceParamsDto extends createZodDto(
  z.object({ vendorId: VendorIdSchema }),
) {}
export class UnsubscribeDto extends createZodDto(UnsubscribeSchema) {}
