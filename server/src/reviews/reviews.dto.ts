import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  PageQuerySchema,
  ProductIdSchema,
  ReviewCreateBodySchema,
  ReviewPageSchema,
  ReviewSchema,
} from '@repo/core';

export class ReviewCreateBodyDto extends createZodDto(ReviewCreateBodySchema) {}
export class ReviewDto extends createZodDto(ReviewSchema) {}
export class ReviewPageDto extends createZodDto(ReviewPageSchema) {}
export class ReviewPageQueryDto extends createZodDto(PageQuerySchema) {}
export class ReviewProductParamsDto extends createZodDto(z.object({ id: ProductIdSchema })) {}
