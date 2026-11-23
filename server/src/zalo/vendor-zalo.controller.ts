import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ZaloAccountResponse,
  ZaloLoginStart,
  ZaloLoginState,
  ZaloMessagePage,
  ZaloTemplate,
  ZaloTemplateList,
} from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Idempotent } from '../common/idempotency/idempotent.decorator';
import { RateLimit } from '../common/rate-limit';
import { BEARER_AUTH } from '../openapi/openapi';
import { requireVendorId } from './vendor-access';
import {
  ZaloAccountResponseDto,
  ZaloLoginParamsDto,
  ZaloLoginStartDto,
  ZaloLoginStateDto,
  ZaloMessageListQueryDto,
  ZaloMessagePageDto,
  ZaloTemplateDto,
  ZaloTemplateListDto,
  ZaloTemplateParamsDto,
  ZaloTemplateUpsertDto,
} from './zalo.dto';
import { ZaloAccountService } from './zalo-account.service';
import { ZaloMessagesService } from './zalo-messages.service';
import { ZaloTemplatesService } from './zalo-templates.service';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated ULID; a retry with the same key replays the first response.',
} as const;

/**
 * The signed-in vendor's Zalo automation: account (QR login via workers/zalo), message templates,
 * delivery log. Vendor scope always from the JWT; writes re-check the vendor in the DB.
 */
@ApiTags('vendor-zalo')
@ApiBearerAuth(BEARER_AUTH)
@Controller('vendor/zalo')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VendorZaloController {
  constructor(
    private readonly accounts: ZaloAccountService,
    private readonly templates: ZaloTemplatesService,
    private readonly messages: ZaloMessagesService,
  ) {}

  @ApiOperation({ summary: 'The shop’s connected Zalo account (null when never connected)' })
  @ZodResponse({ status: 200, description: 'Account', type: ZaloAccountResponseDto })
  @Get('account')
  @Roles('VENDOR_OWNER', 'VENDOR_STAFF')
  account(@CurrentUser() user: AuthUser): Promise<ZaloAccountResponse> {
    return this.accounts.get(requireVendorId(user));
  }

  @ApiOperation({
    summary: 'Start a QR login for the shop’s Zalo account',
    description:
      'Queues the login for the Zalo worker. Poll `GET /v1/vendor/zalo/login-requests/{loginId}` ' +
      '(~1s) to get the QR image, then the scan / success state. A successful login replaces the ' +
      'shop’s current account.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 202, description: 'Login queued', type: ZaloLoginStartDto })
  @Post('login-requests')
  @HttpCode(202)
  @Idempotent()
  @RateLimit('strict')
  @Roles('VENDOR_OWNER')
  startLogin(@CurrentUser() user: AuthUser): Promise<ZaloLoginStart> {
    return this.accounts.startLogin(requireVendorId(user), user.id);
  }

  @ApiOperation({ summary: 'State of a QR login request (QR image, scanned, success, …)' })
  @ZodResponse({ status: 200, description: 'Login state', type: ZaloLoginStateDto })
  @Get('login-requests/:loginId')
  @Roles('VENDOR_OWNER')
  loginState(
    @CurrentUser() user: AuthUser,
    @Param() params: ZaloLoginParamsDto,
  ): Promise<ZaloLoginState> {
    return this.accounts.getLoginState(requireVendorId(user), user.id, params.loginId);
  }

  @ApiOperation({ summary: 'Disconnect the shop’s Zalo account (wipes the saved session)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({
    status: 200,
    description: 'Account after disconnect',
    type: ZaloAccountResponseDto,
  })
  @Post('account/disconnect')
  @HttpCode(200)
  @Idempotent()
  @Roles('VENDOR_OWNER')
  disconnect(@CurrentUser() user: AuthUser): Promise<ZaloAccountResponse> {
    return this.accounts.disconnect(requireVendorId(user), user.id);
  }

  @ApiOperation({ summary: 'Message template of every event (unconfigured = disabled)' })
  @ZodResponse({ status: 200, description: 'Templates', type: ZaloTemplateListDto })
  @Get('templates')
  @Roles('VENDOR_OWNER', 'VENDOR_STAFF')
  listTemplates(@CurrentUser() user: AuthUser): Promise<ZaloTemplateList> {
    return this.templates.list(requireVendorId(user));
  }

  @ApiOperation({
    summary: 'Create or replace the template of one event',
    description:
      'Body placeholders `{{name}}` must be one of the listed placeholders. `delayMinutes` is ' +
      'only used by AFTER_DELIVERY (stored as 0 for every other event).',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ZodResponse({ status: 200, description: 'The template', type: ZaloTemplateDto })
  @Put('templates/:event')
  @Idempotent()
  @Roles('VENDOR_OWNER', 'VENDOR_STAFF')
  upsertTemplate(
    @CurrentUser() user: AuthUser,
    @Param() params: ZaloTemplateParamsDto,
    @Body() body: ZaloTemplateUpsertDto,
  ): Promise<ZaloTemplate> {
    return this.templates.upsert(requireVendorId(user), params.event, body);
  }

  @ApiOperation({ summary: 'Automated message log, newest first (cursor pagination)' })
  @ZodResponse({ status: 200, description: 'One page of messages', type: ZaloMessagePageDto })
  @Get('messages')
  @Roles('VENDOR_OWNER', 'VENDOR_STAFF')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Query() query: ZaloMessageListQueryDto,
  ): Promise<ZaloMessagePage> {
    return this.messages.list(requireVendorId(user), query);
  }
}
