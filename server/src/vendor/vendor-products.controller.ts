import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { VendorProduct, VendorProductPage, VendorProductVariant } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import {
  ProductUpsertDto,
  VariantStockUpdateDto,
  VendorProductDto,
  VendorProductPageDto,
  VendorProductParamsDto,
  VendorProductQueryDto,
  VendorProductVariantDto,
  VendorVariantParamsDto,
} from './vendor.dto';
import { VendorProductsService } from './vendor-products.service';
import { VendorMembershipGuard } from './vendor-membership.guard';
import { requireVendorId } from './vendor-scope';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated ULID; a retry with the same key replays the first response.',
} as const;

/** The signed-in vendor's catalog. The vendor comes from the JWT only; other vendors' rows are 404. */
@ApiTags('vendor-catalog')
@ApiBearerAuth(BEARER_AUTH)
@Controller('vendor')
@UseGuards(JwtAuthGuard, RolesGuard, VendorMembershipGuard)
@Roles('VENDOR_OWNER', 'VENDOR_STAFF')
export class VendorProductsController {
  constructor(private readonly products: VendorProductsService) {}

  @ApiOperation({ summary: 'Own products, newest first (cursor pagination, optional status)' })
  @ZodResponse({ status: 200, description: 'One page of products', type: VendorProductPageDto })
  @Get('products')
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: VendorProductQueryDto,
  ): Promise<VendorProductPage> {
    return this.products.list(requireVendorId(user), query);
  }

  @ApiOperation({
    summary: 'Create a DRAFT product',
    description:
      '`status` in the body is ignored. Variant/image `id`s are not allowed on create. ' +
      '`basePrice` is stored as the lowest variant price.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 201, description: 'The created product', type: VendorProductDto })
  @Post('products')
  @Idempotent()
  create(@CurrentUser() user: AuthUser, @Body() body: ProductUpsertDto): Promise<VendorProduct> {
    return this.products.create(requireVendorId(user), body);
  }

  @ApiOperation({ summary: 'One own product with raw translations and stock counters' })
  @ZodResponse({ status: 200, description: 'The product', type: VendorProductDto })
  @Get('products/:id')
  get(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorProductParamsDto,
  ): Promise<VendorProduct> {
    return this.products.get(requireVendorId(user), params.id);
  }

  @ApiOperation({
    summary: 'Replace translations, variants, images and categories of an own product',
    description:
      'Variants are matched by `id`, else by `sku`; variants missing from the payload are deleted ' +
      'unless ordered or carted (409 `product.error.variant-in-use`: set stock to 0 instead). ' +
      '`stockOnHand` never goes below the reserved quantity (409 `product.error.stock-below-reserved`). ' +
      '`status` in the body is ignored; use publish / archive.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The updated product', type: VendorProductDto })
  @Put('products/:id')
  @Idempotent()
  update(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorProductParamsDto,
    @Body() body: ProductUpsertDto,
  ): Promise<VendorProduct> {
    return this.products.update(requireVendorId(user), params.id, body);
  }

  @ApiOperation({
    summary: 'Publish (ACTIVE) an own product',
    description:
      'Needs a Vietnamese name and a variant priced above zero (422 `product.error.not-publishable`); ' +
      'BLOCKED products → 409 `product.error.blocked`.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The product', type: VendorProductDto })
  @Post('products/:id/publish')
  @HttpCode(200)
  @Idempotent()
  publish(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorProductParamsDto,
  ): Promise<VendorProduct> {
    return this.products.publish(requireVendorId(user), params.id);
  }

  @ApiOperation({ summary: 'Archive an own product (hidden from the storefront)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The product', type: VendorProductDto })
  @Post('products/:id/archive')
  @HttpCode(200)
  @Idempotent()
  archive(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorProductParamsDto,
  ): Promise<VendorProduct> {
    return this.products.archive(requireVendorId(user), params.id);
  }

  @ApiOperation({
    summary: 'Set the absolute on-hand stock of an own variant',
    description: 'Below the reserved quantity → 409 `product.error.stock-below-reserved`.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The variant', type: VendorProductVariantDto })
  @Patch('variants/:id/stock')
  @Idempotent()
  setStock(
    @CurrentUser() user: AuthUser,
    @Param() params: VendorVariantParamsDto,
    @Body() body: VariantStockUpdateDto,
  ): Promise<VendorProductVariant> {
    return this.products.setStock(requireVendorId(user), params.id, body.stockOnHand);
  }
}
