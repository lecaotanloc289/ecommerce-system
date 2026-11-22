import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformOrderDetail, PlatformOrderPage } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BEARER_AUTH } from '../openapi/openapi';
import {
  PlatformOrderDetailDto,
  PlatformOrderListQueryDto,
  PlatformOrderPageDto,
  PlatformOrderParamsDto,
} from './platform.dto';
import { PlatformOrdersService } from './platform-orders.service';

@ApiTags('platform')
@ApiBearerAuth(BEARER_AUTH)
@Controller('platform/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PLATFORM_STAFF', 'PLATFORM_ADMIN')
export class PlatformOrdersController {
  constructor(private readonly orders: PlatformOrdersService) {}

  @ApiOperation({
    summary: 'Orders of every customer, newest first',
    description: '`q` matches the order id (prefix) or the customer email (substring).',
  })
  @ZodResponse({ status: 200, description: 'One page', type: PlatformOrderPageDto })
  @Get()
  list(@Query() query: PlatformOrderListQueryDto): Promise<PlatformOrderPage> {
    return this.orders.list(query);
  }

  @ApiOperation({
    summary: 'Order with sub-orders, items, payments, ledger entries and refunds',
    description: 'Payments never include the provider raw payload.',
  })
  @ZodResponse({ status: 200, description: 'The order', type: PlatformOrderDetailDto })
  @Get(':id')
  get(@Param() params: PlatformOrderParamsDto): Promise<PlatformOrderDetail> {
    return this.orders.get(params.id);
  }
}
