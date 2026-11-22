import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DomainError, type PresignResponse } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BEARER_AUTH } from '../openapi/openapi';
import { StorageService } from './storage.service';
import { PresignRequestDto, PresignResponseDto } from './uploads.dto';

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  /**
   * No `@Idempotent()`: presigning creates no server state (a retry just yields another unused
   * key). Default rate-limit bucket applies.
   */
  @ApiOperation({
    summary: 'Presign an upload (PUT to the returned URL with the returned headers)',
    description:
      '`kyc` requires CUSTOMER; `product-image` / `vendor-logo` require VENDOR_OWNER or VENDOR_STAFF ' +
      '(vendor taken from the access token). The PUT body must be exactly `size` bytes.',
  })
  @ApiBearerAuth(BEARER_AUTH)
  @ZodResponse({ status: 200, description: 'Presigned PUT target', type: PresignResponseDto })
  @Post('presign')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER', 'VENDOR_OWNER', 'VENDOR_STAFF')
  presign(
    @CurrentUser() user: AuthUser,
    @Body() body: PresignRequestDto,
  ): Promise<PresignResponse> {
    if (body.purpose === 'kyc') {
      if (!user.roles.includes('CUSTOMER')) throw new DomainError('common.error.forbidden');
      return this.storage.presignPut(
        body.purpose,
        { type: 'user', userId: user.id },
        body.contentType,
        body.size,
      );
    }
    const isVendorUser = user.roles.includes('VENDOR_OWNER') || user.roles.includes('VENDOR_STAFF');
    if (!isVendorUser || !user.vendorId) throw new DomainError('common.error.forbidden');
    return this.storage.presignPut(
      body.purpose,
      { type: 'vendor', vendorId: user.vendorId },
      body.contentType,
      body.size,
    );
  }
}
