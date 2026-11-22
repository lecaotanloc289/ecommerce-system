import { UseInterceptors, applyDecorators } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor';

/**
 * Makes a mutation idempotent (Golden Rule #3): requires an `Idempotency-Key` ULID header and
 * replays the first successful response for 24h. Put it on handlers behind `JwtAuthGuard`
 * (keys are scoped per user). Mandatory on `/orders/checkout` and `/payments/*`.
 *
 * ```ts
 * @Post('checkout')
 * @UseGuards(JwtAuthGuard, RolesGuard)
 * @Roles('CUSTOMER')
 * @Idempotent()
 * checkout(...) {}
 * ```
 */
export const Idempotent = (): MethodDecorator & ClassDecorator =>
  applyDecorators(UseInterceptors(IdempotencyInterceptor));
