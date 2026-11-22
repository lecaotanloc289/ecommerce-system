import { createZodDto } from 'nestjs-zod';
import { MeResponseSchema, TokenResponseSchema } from './auth.schemas';

/** OpenAPI/response DTOs for the auth controller (schemas live in `auth.schemas.ts`). */
export class TokenResponseDto extends createZodDto(TokenResponseSchema) {}
export class MeResponseDto extends createZodDto(MeResponseSchema) {}
