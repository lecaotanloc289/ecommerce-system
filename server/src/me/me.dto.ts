import {
  AddressInputSchema,
  AddressParamsSchema,
  AddressSchema,
  AddressUpdateSchema,
  ProfileUpdateSchema,
} from '@repo/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** DTOs for the `/me` controller (schemas live in `@repo/core/schemas/{address,me}`). */
export class AddressDto extends createZodDto(AddressSchema) {}
export class AddressListDto extends createZodDto(z.array(AddressSchema)) {}
export class AddressInputDto extends createZodDto(AddressInputSchema) {}
export class AddressUpdateDto extends createZodDto(AddressUpdateSchema) {}
export class AddressParamsDto extends createZodDto(AddressParamsSchema) {}
export class ProfileUpdateDto extends createZodDto(ProfileUpdateSchema) {}
