import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  IdempotencyKeySchema,
  type Order,
  type OrderSummaryPage,
  type PaymentSession,
} from '@repo/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { IDEMPOTENCY_KEY_HEADER } from '../common/idempotency/idempotency.interceptor';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { clientIp, RateLimit } from '../common/rate-limit';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { BEARER_AUTH } from '../openapi/openapi';
import { CheckoutService } from './checkout.service';
import {
  CheckoutDto,
  OrderDto,
  OrderPageQueryDto,
  OrderParamsDto,
  OrderSummaryPageDto,
  PaymentRetryDto,
  PaymentSessionDto,
  SubOrderParamsDto,
} from './orders.dto';
import { OrdersService } from './orders.service';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated ULID; a retry with the same key replays the first response.',
} as const;

/** The signed-in customer's orders. Ownership always from the JWT; another user's order is 404. */
@ApiTags('orders')
@ApiBearerAuth(BEARER_AUTH)
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class OrdersController {
  constructor(
    private readonly checkoutService: CheckoutService,
    private readonly orders: OrdersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @ApiOperation({
    summary: 'Check out: split into one sub-order per vendor, reserve stock, request payment',
    description:
      'Prices, vendors, shipping fees and commission come from the DB. Returns the order with a ' +
      'PENDING payment whose provider session is created asynchronously: poll ' +
      '`GET /v1/orders/{id}/payment` for the redirect URL.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 201, description: 'The created order', type: OrderDto })
  @Post('checkout')
  @Idempotent()
  @RateLimit('strict')
  async checkout(
    @CurrentUser() user: AuthUser,
    @Body() body: CheckoutDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string,
    @Req() request: FastifyRequest,
  ): Promise<Order> {
    // Already validated by @Idempotent(); parsed again for the type.
    const key = IdempotencyKeySchema.parse(idempotencyKey);
    const ip = clientIp(request, this.env.TRUSTED_PROXY_HOPS);
    const orderId = await this.checkoutService.checkout(user.id, body, key, ip);
    return this.orders.get(user.id, orderId);
  }

  @ApiOperation({ summary: 'Order history, newest first (cursor pagination)' })
  @ZodResponse({ status: 200, description: 'One page of orders', type: OrderSummaryPageDto })
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: OrderPageQueryDto,
  ): Promise<OrderSummaryPage> {
    return this.orders.list(user.id, query);
  }

  @ApiOperation({ summary: 'One own order with its sub-orders and items' })
  @ZodResponse({ status: 200, description: 'The order', type: OrderDto })
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param() params: OrderParamsDto): Promise<Order> {
    return this.orders.get(user.id, params.id);
  }

  @ApiOperation({
    summary: 'Payment session of the latest attempt (poll after checkout)',
    description:
      '202 while the latest attempt is PENDING and its provider session is not created yet ' +
      '(`redirectUrl: null`) — poll again (1s, up to 30s). 200 once there is a `redirectUrl`, or ' +
      'when the attempt is no longer PENDING (CONFIRMED / FAILED: check `status`). A PENDING ' +
      'session past `expiresAt` needs `POST /v1/orders/{id}/payments`.',
  })
  @ApiResponse({ status: 202, description: 'Session not ready yet', type: PaymentSessionDto })
  @ZodResponse({ status: 200, description: 'Session ready', type: PaymentSessionDto })
  @Get(':id/payment')
  async payment(
    @CurrentUser() user: AuthUser,
    @Param() params: OrderParamsDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PaymentSession> {
    const { session, ready } = await this.orders.getPaymentSession(user.id, params.id);
    if (!ready) void reply.status(202);
    return session;
  }

  @ApiOperation({ summary: 'Cancel an unpaid order (every sub-order still AWAITING_PAYMENT)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The cancelled order', type: OrderDto })
  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent()
  cancel(@CurrentUser() user: AuthUser, @Param() params: OrderParamsDto): Promise<Order> {
    return this.orders.cancel(user.id, params.id);
  }

  @ApiOperation({
    summary: 'Start a new payment attempt after the previous one failed or expired',
    description:
      'Optional `provider` switches the gateway. The new attempt is PENDING without a session; ' +
      'poll `GET /v1/orders/{id}/payment` as after checkout.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 201, description: 'The new attempt', type: PaymentSessionDto })
  @Post(':id/payments')
  @Idempotent()
  @RateLimit('strict')
  retryPayment(
    @CurrentUser() user: AuthUser,
    @Param() params: OrderParamsDto,
    @Body() body: PaymentRetryDto,
    @Req() request: FastifyRequest,
  ): Promise<PaymentSession> {
    const ip = clientIp(request, this.env.TRUSTED_PROXY_HOPS);
    return this.orders.retryPayment(user.id, params.id, body, ip);
  }

  @ApiOperation({
    summary: 'Confirm a parcel was received (sub-order SHIPPED | DELIVERED → COMPLETED)',
    description: 'Starts the payout hold period of that vendor. Returns the whole order.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The order', type: OrderDto })
  @Post(':orderId/sub-orders/:id/confirm-received')
  @HttpCode(200)
  @Idempotent()
  confirmReceived(
    @CurrentUser() user: AuthUser,
    @Param() params: SubOrderParamsDto,
  ): Promise<Order> {
    return this.orders.confirmReceived(user.id, params.orderId, params.id);
  }
}
