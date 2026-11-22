import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { VendorMembershipGuard } from './vendor-membership.guard';
import { VendorProductsController } from './vendor-products.controller';
import { VendorProductsService } from './vendor-products.service';
import { VendorShippingController } from './vendor-shipping.controller';
import { VendorShippingService } from './vendor-shipping.service';

/** Vendor-portal catalog API: products, variant stock, shipping methods. */
@Module({
  imports: [AuthModule, StorageModule],
  controllers: [VendorProductsController, VendorShippingController],
  providers: [VendorProductsService, VendorShippingService, VendorMembershipGuard],
})
export class VendorModule {}
