import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VendorMembershipGuard } from '../vendor/vendor-membership.guard';
import { CrmAutomationsController } from './crm-automations.controller';
import { CrmAutomationsService } from './crm-automations.service';
import { CrmCampaignsController } from './crm-campaigns.controller';
import { CrmCampaignsService } from './crm-campaigns.service';
import { CrmCustomersController } from './crm-customers.controller';
import { CrmCustomersRepository } from './crm-customers.repository';
import { CrmCustomersService } from './crm-customers.service';
import { PlatformCrmCampaignsController } from './platform-crm-campaigns.controller';

/**
 * Vendor CRM (`/v1/vendor/crm/*`) + platform campaign oversight (`/v1/platform/crm/*`).
 * Plan: docs/superpowers/plans/2026-11-23-vendor-crm.md (K4a). Exports the repository so the
 * audience resolver (`resolveAudience`) can be reused.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    CrmCustomersController,
    CrmAutomationsController,
    CrmCampaignsController,
    PlatformCrmCampaignsController,
  ],
  providers: [
    CrmCustomersRepository,
    CrmCustomersService,
    CrmAutomationsService,
    CrmCampaignsService,
    VendorMembershipGuard,
  ],
  exports: [CrmCustomersRepository],
})
export class CrmModule {}
