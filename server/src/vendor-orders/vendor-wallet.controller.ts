import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { LedgerEntryPage, VendorWallet } from '@repo/core';
import { ZodResponse } from 'nestjs-zod';
import type { AuthUser } from '../auth/auth.schemas';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BEARER_AUTH } from '../openapi/openapi';
import { VendorMembershipGuard } from '../vendor/vendor-membership.guard';
import { requireVendorId } from '../vendor/vendor-scope';
import { LedgerEntryPageDto, LedgerPageQueryDto, VendorWalletDto } from './vendor-orders.dto';
import { VendorWalletService } from './vendor-wallet.service';

/** The signed-in vendor's wallet and ledger — owner only (staff have no payout access). */
@ApiTags('vendor-wallet')
@ApiBearerAuth(BEARER_AUTH)
@Controller('vendor')
@UseGuards(JwtAuthGuard, RolesGuard, VendorMembershipGuard)
@Roles('VENDOR_OWNER')
export class VendorWalletController {
  constructor(private readonly wallets: VendorWalletService) {}

  @ApiOperation({
    summary: 'Released balance + pending net (paid, not yet paid out) per currency',
  })
  @ZodResponse({ status: 200, description: 'The wallet', type: VendorWalletDto })
  @Get('wallet')
  wallet(@CurrentUser() user: AuthUser): Promise<VendorWallet> {
    return this.wallets.wallet(user.id, requireVendorId(user));
  }

  @ApiOperation({ summary: 'Own wallet ledger lines, newest first (cursor pagination)' })
  @ZodResponse({ status: 200, description: 'One page of ledger lines', type: LedgerEntryPageDto })
  @Get('ledger')
  ledger(
    @CurrentUser() user: AuthUser,
    @Query() query: LedgerPageQueryDto,
  ): Promise<LedgerEntryPage> {
    return this.wallets.ledger(user.id, requireVendorId(user), query);
  }
}
