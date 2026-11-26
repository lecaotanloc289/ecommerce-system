import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CrmUnsubscribeController, VendorPreferencesController } from './crm-consent.controller';
import { CrmConsentService } from './crm-consent.service';

@Module({
  imports: [AuthModule],
  controllers: [VendorPreferencesController, CrmUnsubscribeController],
  providers: [CrmConsentService],
})
export class CrmConsentModule {}
