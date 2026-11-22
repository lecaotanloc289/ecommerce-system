import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Cart, CartMergeResult, CartShippingOptions } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { BEARER_AUTH } from '../openapi/openapi';
import {
  CartDto,
  CartItemSetDto,
  CartMergeInputDto,
  CartMergeResultDto,
  CartQueryDto,
  CartShippingOptionsDto,
  CartVariantParamDto,
} from './cart.dto';
import { CartService } from './cart.service';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated ULID; a retry with the same key replays the first response.',
} as const;

/** The signed-in customer's cart. Prices are never stored — every read uses the current variant price. */
@ApiTags('cart')
@ApiBearerAuth(BEARER_AUTH)
@Controller('cart')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @ApiOperation({ summary: 'Current cart, lines grouped by vendor' })
  @ZodResponse({ status: 200, description: 'The cart', type: CartDto })
  @Get()
  get(@CurrentUser() user: AuthUser, @Query() query: CartQueryDto): Promise<Cart> {
    return this.cart.getCart(user.id, query.locale);
  }

  @ApiOperation({ summary: 'Active shipping methods of every vendor in the cart' })
  @ZodResponse({ status: 200, description: 'Shipping options', type: CartShippingOptionsDto })
  @Get('shipping-options')
  shippingOptions(@CurrentUser() user: AuthUser): Promise<CartShippingOptions> {
    return this.cart.getShippingOptions(user.id);
  }

  @ApiOperation({ summary: 'Set a line quantity (0 removes it)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The updated cart', type: CartDto })
  @Put('items/:variantId')
  @Idempotent()
  setItem(
    @CurrentUser() user: AuthUser,
    @Param() params: CartVariantParamDto,
    @Body() body: CartItemSetDto,
    @Query() query: CartQueryDto,
  ): Promise<Cart> {
    return this.cart.setItem(user.id, params.variantId, body.quantity, query.locale);
  }

  @ApiOperation({ summary: 'Remove a line (no-op when absent)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The updated cart', type: CartDto })
  @Delete('items/:variantId')
  @Idempotent()
  removeItem(
    @CurrentUser() user: AuthUser,
    @Param() params: CartVariantParamDto,
    @Query() query: CartQueryDto,
  ): Promise<Cart> {
    return this.cart.removeItem(user.id, params.variantId, query.locale);
  }

  @ApiOperation({
    summary: 'Merge the guest cart after sign-in',
    description:
      'Adds the guest quantities to the existing lines, clamped to stock; unknown or unsellable ' +
      'variants are dropped. Returns the cart plus the adjustments to show the customer. Call it ' +
      'ONCE after login and then clear the guest cart: the same Idempotency-Key replays the first ' +
      'result, a new key adds the quantities again.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'Cart and adjustments', type: CartMergeResultDto })
  @Post('merge')
  @HttpCode(200)
  @Idempotent()
  merge(
    @CurrentUser() user: AuthUser,
    @Body() body: CartMergeInputDto,
    @Query() query: CartQueryDto,
  ): Promise<CartMergeResult> {
    return this.cart.merge(user.id, body.items, query.locale);
  }
}
