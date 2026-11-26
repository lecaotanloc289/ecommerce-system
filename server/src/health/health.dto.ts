import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  timestamp: z.iso.datetime(),
});

export const HealthReadyResponseSchema = z.object({
  status: z.literal('ok'),
  db: z.literal('up'),
});

export class HealthResponseDto extends createZodDto(HealthResponseSchema) {}
export class HealthReadyResponseDto extends createZodDto(HealthReadyResponseSchema) {}
