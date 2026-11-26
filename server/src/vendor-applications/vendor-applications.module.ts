import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { PlatformVendorApplicationsController } from './platform-vendor-applications.controller';
import { VendorApplicationsController } from './vendor-applications.controller';
import { VendorApplicationsService } from './vendor-applications.service';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [VendorApplicationsController, PlatformVendorApplicationsController],
  providers: [VendorApplicationsService],
})
export class VendorApplicationsModule {}
