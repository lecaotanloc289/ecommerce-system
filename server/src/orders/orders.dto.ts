import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  CheckoutSchema,
  OrderIdSchema,
  OrderSchema,
  OrderSummaryPageSchema,
  PageQuerySchema,
  PaymentRetrySchema,
  PaymentSessionSchema,
} from '@repo/core';

/** OpenAPI/request/response DTOs for the orders controller (schemas live in `@repo/core`). */
export class CheckoutDto extends createZodDto(CheckoutSchema) {}
export class OrderDto extends createZodDto(OrderSchema) {}
export class OrderSummaryPageDto extends createZodDto(OrderSummaryPageSchema) {}
export class OrderPageQueryDto extends createZodDto(PageQuerySchema) {}
export class PaymentSessionDto extends createZodDto(PaymentSessionSchema) {}
export class PaymentRetryDto extends createZodDto(PaymentRetrySchema) {}
export class OrderParamsDto extends createZodDto(z.object({ id: OrderIdSchema })) {}
