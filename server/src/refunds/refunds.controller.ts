import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Refund, RefundPage } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { RateLimit } from '../common/rate-limit';
import { BEARER_AUTH } from '../openapi/openapi';
import {
  RefundCreateDto,
  RefundDto,
  RefundListQueryDto,
  RefundPageDto,
  RefundParamsDto,
  SubOrderParamsDto,
} from './refunds.dto';
import { RefundsService } from './refunds.service';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated ULID; a retry with the same key replays the first response.',
} as const;

/** Platform refunds (roadmap D12): admin-initiated, whole sub-order. */
@ApiTags('platform')
@ApiBearerAuth(BEARER_AUTH)
@Controller('platform')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PLATFORM_STAFF', 'PLATFORM_ADMIN')
export class PlatformRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @ApiOperation({
    summary: 'Refund a whole sub-order (admin)',
    description:
      'Amount = what the customer paid for the sub-order. Sub-order → REFUNDED, stock returned ' +
      'when not yet shipped, escrow → customer in the ledger, order status re-derived; the ' +
      'provider refund runs asynchronously (refund PENDING until the worker settles it). ' +
      'Not PAID..DELIVERED, payout already released, no confirmed payment or a refund already ' +
      'exists → 409 `refund.error.not-refundable`; unknown sub-order → 404 ' +
      '`sub-order.error.not-found`; refunding your own order → 403 `common.error.forbidden`.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 201, description: 'The created refund', type: RefundDto })
  @Post('sub-orders/:id/refund')
  @Roles('PLATFORM_ADMIN')
  @Idempotent()
  @RateLimit('strict')
  refund(
    @CurrentUser() user: AuthUser,
    @Param() params: SubOrderParamsDto,
    @Body() body: RefundCreateDto,
  ): Promise<Refund> {
    return this.refunds.refundSubOrder(user.id, params.id, body);
  }

  @ApiOperation({
    summary: 'Retry a FAILED provider refund (admin)',
    description:
      'Recovery path when the provider refused a refund: inserts a NEW PENDING refund (same ' +
      'amount, currency, payment and sub-order; reason references the failed one) and asks the ' +
      'worker to call the provider again. The ledger is not touched (the original refund already ' +
      'moved the money to the customer). Refund not FAILED, sub-order not REFUNDED (or CANCELLED ' +
      'for a late-payment refund), or another PENDING/SUCCEEDED refund exists → 409 ' +
      '`refund.error.not-refundable` (`reason`: `refund-not-failed` | `status` | ' +
      '`refund-exists`); unknown refund → 404 `common.error.not-found`; your own order → 403.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 201, description: 'The new PENDING refund', type: RefundDto })
  @Post('refunds/:id/retry')
  @Roles('PLATFORM_ADMIN')
  @Idempotent()
  @RateLimit('strict')
  retry(@CurrentUser() user: AuthUser, @Param() params: RefundParamsDto): Promise<Refund> {
    return this.refunds.retryRefund(user.id, params.id);
  }

  @ApiOperation({ summary: 'Refunds, newest first, optional `status` filter' })
  @ZodResponse({ status: 200, description: 'One page', type: RefundPageDto })
  @Get('refunds')
  list(@Query() query: RefundListQueryDto): Promise<RefundPage> {
    return this.refunds.list(query);
  }
}
