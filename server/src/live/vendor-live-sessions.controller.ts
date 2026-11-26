import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type LiveIngestCredentials,
  type LiveSessionId,
  type ProductId,
  Role,
  type VendorLiveSession,
} from '@repo/core';
import type { FastifyReply } from 'fastify';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CreateLiveSessionDto,
  ListLiveSessionsQueryDto,
  ReplaceLiveSessionProductsDto,
} from './live.dto';
import { LiveSessionIdPipe, ProductIdPipe } from './live-params.pipe';
import { LiveSessionService } from './live-session.service';

/** Vendor broadcast management (decision D4: owners and staff). Scope = the caller's vendor. */
@Controller('vendor/live-sessions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.VENDOR_OWNER, Role.VENDOR_STAFF)
export class VendorLiveSessionsController {
  constructor(private readonly sessions: LiveSessionService) {}

  /** 201 on create, 200 on an idempotent replay (same `Idempotency-Key`). */
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateLiveSessionDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { session, isCreated } = await this.sessions.create(user, idempotencyKey, body);
    await reply.code(isCreated ? 201 : 200).send(session);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListLiveSessionsQueryDto,
  ): Promise<VendorLiveSession[]> {
    return this.sessions.listForVendor(user, query.status);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
  ): Promise<VendorLiveSession> {
    return this.sessions.getForVendor(user, id);
  }

  @Get(':id/ingest-credentials')
  @Header('Cache-Control', 'no-store')
  ingestCredentials(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
  ): Promise<LiveIngestCredentials> {
    return this.sessions.getIngestCredentials(user, id);
  }

  @Put(':id/products')
  replaceProducts(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
    @Body() body: ReplaceLiveSessionProductsDto,
  ): Promise<VendorLiveSession> {
    return this.sessions.replaceProducts(user, id, body);
  }

  @Post(':id/products/:productId/pin')
  @HttpCode(200)
  pin(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
    @Param('productId', ProductIdPipe) productId: ProductId,
  ): Promise<VendorLiveSession> {
    return this.sessions.pinProduct(user, id, productId);
  }

  @Post(':id/products/:productId/unpin')
  @HttpCode(200)
  unpin(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
    @Param('productId', ProductIdPipe) productId: ProductId,
  ): Promise<VendorLiveSession> {
    return this.sessions.unpinProduct(user, id, productId);
  }

  @Post(':id/go-live')
  @HttpCode(200)
  goLive(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
  ): Promise<VendorLiveSession> {
    return this.sessions.goLive(user, id);
  }

  @Post(':id/end')
  @HttpCode(200)
  end(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
  ): Promise<VendorLiveSession> {
    return this.sessions.end(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', LiveSessionIdPipe) id: LiveSessionId,
  ): Promise<VendorLiveSession> {
    return this.sessions.cancel(user, id);
  }
}
