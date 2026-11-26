import { PresignRequestSchema, PresignResponseSchema } from '@repo/core';
import { createZodDto } from 'nestjs-zod';

export class PresignRequestDto extends createZodDto(PresignRequestSchema) {}
export class PresignResponseDto extends createZodDto(PresignResponseSchema) {}
