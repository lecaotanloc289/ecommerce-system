import { createZodDto } from 'nestjs-zod';
import { MeResponseSchema, TokenResponseSchema } from '@repo/core';

/** OpenAPI/response DTOs for the auth controller (schemas live in `@repo/core/schemas/me`). */
export class TokenResponseDto extends createZodDto(TokenResponseSchema) {}
export class MeResponseDto extends createZodDto(MeResponseSchema) {}
