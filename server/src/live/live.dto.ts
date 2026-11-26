import {
  CreateLiveSessionSchema,
  ListLiveSessionsQuerySchema,
  ReplaceLiveSessionProductsSchema,
  SimulateEncoderSchema,
  TerminateLiveSessionSchema,
} from '@repo/core';
import { createZodDto } from 'nestjs-zod';

// Request DTOs = the core schemas (Golden Rule #1); the global ZodValidationPipe parses them.
export class CreateLiveSessionDto extends createZodDto(CreateLiveSessionSchema) {}
export class ReplaceLiveSessionProductsDto extends createZodDto(ReplaceLiveSessionProductsSchema) {}
export class TerminateLiveSessionDto extends createZodDto(TerminateLiveSessionSchema) {}
export class ListLiveSessionsQueryDto extends createZodDto(ListLiveSessionsQuerySchema) {}
export class SimulateEncoderDto extends createZodDto(SimulateEncoderSchema) {}
