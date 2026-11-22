import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ShippingMethod } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import {
  ShippingMethodDto,
  ShippingMethodInputDto,
  ShippingMethodListDto,
  ShippingMethodParamsDto,
} from './vendor.dto';
import { VendorShippingService } from './vendor-shipping.service';
import { requireVendorId } from './vendor-scope';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated ULID; a retry with the same key replays the first response.',
} as const;

/** The signed-in vendor's shipping methods (vendor from the JWT; other vendors' methods are 404). */
@ApiTags('vendor-catalog')
@ApiBearerAuth(BEARER_AUTH)
@Controller('vendor/shipping-methods')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('VENDOR_OWNER', 'VENDOR_STAFF')
export class VendorShippingController {
  constructor(private readonly shipping: VendorShippingService) {}

  @ApiOperation({ summary: 'Own shipping methods, active and inactive' })
  @ZodResponse({ status: 200, description: 'Shipping methods', type: ShippingMethodListDto })
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ShippingMethod[]> {
    return this.shipping.list(requireVendorId(user));
  }

  @ApiOperation({ summary: 'Create a shipping method' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 201, description: 'The shipping method', type: ShippingMethodDto })
  @Post()
  @Idempotent()
  create(
    @CurrentUser() user: AuthUser,
    @Body() body: ShippingMethodInputDto,
  ): Promise<ShippingMethod> {
    return this.shipping.create(requireVendorId(user), body);
  }

  @ApiOperation({ summary: 'Replace an own shipping method' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The shipping method', type: ShippingMethodDto })
  @Put(':id')
  @Idempotent()
  update(
    @CurrentUser() user: AuthUser,
    @Param() params: ShippingMethodParamsDto,
    @Body() body: ShippingMethodInputDto,
  ): Promise<ShippingMethod> {
    return this.shipping.update(requireVendorId(user), params.id, body);
  }

  @ApiOperation({ summary: 'Stop offering an own shipping method at checkout' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The shipping method', type: ShippingMethodDto })
  @Post(':id/deactivate')
  @HttpCode(200)
  @Idempotent()
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param() params: ShippingMethodParamsDto,
  ): Promise<ShippingMethod> {
    return this.shipping.deactivate(requireVendorId(user), params.id);
  }
}
