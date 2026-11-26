import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VendorZaloController } from './vendor-zalo.controller';
import { ZaloAccountService } from './zalo-account.service';
import { ZaloMessagesService } from './zalo-messages.service';
import { ZaloTemplatesService } from './zalo-templates.service';

/** Vendor side of automated Zalo messages; delivery itself runs in workers/zalo. */
@Module({
  imports: [AuthModule],
  controllers: [VendorZaloController],
  providers: [ZaloAccountService, ZaloTemplatesService, ZaloMessagesService],
})
export class ZaloModule {}
