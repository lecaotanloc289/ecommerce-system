import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Review, ReviewPage } from '@repo/core';
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
  ReviewCreateBodyDto,
  ReviewDto,
  ReviewPageDto,
  ReviewPageQueryDto,
  ReviewProductParamsDto,
} from './reviews.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@Controller('products/:id/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @ApiOperation({
    summary: 'Reviews of a visible product, newest first, with the rating summary (public)',
  })
  @ZodResponse({ status: 200, description: 'One page of reviews + summary', type: ReviewPageDto })
  @Get()
  list(
    @Param() params: ReviewProductParamsDto,
    @Query() query: ReviewPageQueryDto,
  ): Promise<ReviewPage> {
    return this.reviews.list(params.id, query);
  }

  @ApiOperation({
    summary: 'Review a purchased product (once per sub-order and product)',
    description:
      "The sub-order must be the caller's, DELIVERED or COMPLETED, and contain this product, " +
      'else 422 `review.error.not-eligible`. A second review → 409 `review.error.already-exists`.',
  })
  @ApiBearerAuth(BEARER_AUTH)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated ULID; a retry with the same key replays the first response.',
  })
  @ZodResponse({ status: 201, description: 'The created review', type: ReviewDto })
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER')
  @Idempotent()
  @RateLimit('strict')
  create(
    @CurrentUser() user: AuthUser,
    @Param() params: ReviewProductParamsDto,
    @Body() body: ReviewCreateBodyDto,
  ): Promise<Review> {
    return this.reviews.create(user.id, params.id, body);
  }
}
