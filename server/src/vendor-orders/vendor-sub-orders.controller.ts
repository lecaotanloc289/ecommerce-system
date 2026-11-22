import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { VendorSubOrder, VendorSubOrderPage } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import { VendorMembershipGuard } from '../vendor/vendor-membership.guard';
import { requireVendorId } from '../vendor/vendor-scope';
import {
  SubOrderShipDto,
  VendorSubOrderDto,
  VendorSubOrderPageDto,
  VendorSubOrderParamsDto,
  VendorSubOrderQueryDto,
} from './vendor-orders.dto';
import { VendorSubOrdersService } from './vendor-sub-orders.service';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated ULID; a retry with the same key replays the first response.',
} as const;

/** The signed-in vendor's sub-orders (vendor from the JWT; other vendors' sub-orders are 404). */
@ApiTags('vendor-fulfilment')
@ApiBearerAuth(BEARER_AUTH)
@Controller('vendor/sub-orders')
@UseGuards(JwtAuthGuard, RolesGuard, VendorMembershipGuard)
@Roles('VENDOR_OWNER', 'VENDOR_STAFF')
export class VendorSubOrdersController {
  constructor(private readonly subOrders: VendorSubOrdersService) {}

  @ApiOperation({
    summary: 'Own paid sub-orders, newest first (cursor pagination, optional status)',
    description: 'Unpaid (AWAITING_PAYMENT) and cancelled-unpaid sub-orders are never listed.',
  })
  @ZodResponse({ status: 200, description: 'One page of sub-orders', type: VendorSubOrderPageDto })
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: VendorSubOrderQueryDto,
  ): Promise<VendorSubOrderPage> {
    return this.subOrders.list(requireVendorId(user), query);
  }

  @ApiOperation({
    summary: 'One own sub-order: items, shipping address snapshot, commission and net',
    description:
      'Customer contact = `shippingAddress.recipientName` / `phone` (checkout snapshot).',
  })
  @ZodResponse({ status: 200, description: 'The sub-order', type: VendorSubOrderDto })
  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorSubOrderParamsDto,
  ): Promise<VendorSubOrder> {
    return this.subOrders.get(requireVendorId(user), params.id);
  }

  @ApiOperation({ summary: 'Accept a paid sub-order (PAID → PROCESSING)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The sub-order', type: VendorSubOrderDto })
  @Post(':id/accept')
  @HttpCode(200)
  @Idempotent()
  accept(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorSubOrderParamsDto,
  ): Promise<VendorSubOrder> {
    return this.subOrders.accept(requireVendorId(user), params.id);
  }

  @ApiOperation({ summary: 'Hand over to the carrier (PROCESSING → SHIPPED)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The sub-order', type: VendorSubOrderDto })
  @Post(':id/ship')
  @HttpCode(200)
  @Idempotent()
  ship(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorSubOrderParamsDto,
    @Body() body: SubOrderShipDto,
  ): Promise<VendorSubOrder> {
    return this.subOrders.ship(requireVendorId(user), params.id, body);
  }

  @ApiOperation({ summary: 'Mark as delivered (SHIPPED → DELIVERED)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The sub-order', type: VendorSubOrderDto })
  @Post(':id/deliver')
  @HttpCode(200)
  @Idempotent()
  deliver(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorSubOrderParamsDto,
  ): Promise<VendorSubOrder> {
    return this.subOrders.deliver(requireVendorId(user), params.id);
  }
}
