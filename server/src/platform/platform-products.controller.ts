import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { PlatformProduct, PlatformProductPage } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import {
  PlatformProductBlockDto,
  PlatformProductDto,
  PlatformProductListQueryDto,
  PlatformProductPageDto,
  PlatformProductParamsDto,
} from './platform.dto';
import { IDEMPOTENCY_HEADER } from './platform.headers';
import { PlatformProductsService } from './platform-products.service';

@ApiTags('platform')
@ApiBearerAuth(BEARER_AUTH)
@Controller('platform/products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PLATFORM_STAFF', 'PLATFORM_ADMIN')
export class PlatformProductsController {
  constructor(private readonly products: PlatformProductsService) {}

  @ApiOperation({ summary: 'Products of every vendor, newest first' })
  @ZodResponse({ status: 200, description: 'One page', type: PlatformProductPageDto })
  @Get()
  list(@Query() query: PlatformProductListQueryDto): Promise<PlatformProductPage> {
    return this.products.list(query);
  }

  @ApiOperation({
    summary: 'Block a product (staff or admin)',
    description:
      'Hides it from catalog, cart and checkout; the vendor cannot publish, archive or edit it ' +
      '(`product.error.blocked`). Already BLOCKED → 409 `common.error.conflict`.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The product', type: PlatformProductDto })
  @Post(':id/block')
  @HttpCode(200)
  @Idempotent()
  block(
    @CurrentUser() user: AuthUser,
    @Param() params: PlatformProductParamsDto,
    @Body() body: PlatformProductBlockDto,
  ): Promise<PlatformProduct> {
    return this.products.block(user.id, params.id, body.reason);
  }

  @ApiOperation({
    summary: 'Unblock a product → DRAFT (staff or admin)',
    description: 'The vendor must publish it again. Not BLOCKED → 409 `common.error.conflict`.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The product', type: PlatformProductDto })
  @Post(':id/unblock')
  @HttpCode(200)
  @Idempotent()
  unblock(
    @CurrentUser() user: AuthUser,
    @Param() params: PlatformProductParamsDto,
  ): Promise<PlatformProduct> {
    return this.products.unblock(user.id, params.id);
  }
}
