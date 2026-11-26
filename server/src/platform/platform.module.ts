import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformOrdersController } from './platform-orders.controller';
import { PlatformOrdersService } from './platform-orders.service';
import { PlatformProductsController } from './platform-products.controller';
import { PlatformProductsService } from './platform-products.service';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformSettingsService } from './platform-settings.service';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';
import { PlatformVendorsController } from './platform-vendors.controller';
import { PlatformVendorsService } from './platform-vendors.service';

/** Platform admin API (`/v1/platform/*`) except vendor applications (own module) and refunds. */
@Module({
  imports: [AuthModule],
  controllers: [
    PlatformSettingsController,
    PlatformVendorsController,
    PlatformProductsController,
    PlatformOrdersController,
    PlatformUsersController,
  ],
  providers: [
    PlatformSettingsService,
    PlatformVendorsService,
    PlatformProductsService,
    PlatformOrdersService,
    PlatformUsersService,
  ],
})
export class PlatformModule {}
