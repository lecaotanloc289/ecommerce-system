import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VendorMembershipGuard } from '../vendor/vendor-membership.guard';
import { VendorSubOrdersController } from './vendor-sub-orders.controller';
import { VendorSubOrdersService } from './vendor-sub-orders.service';
import { VendorWalletController } from './vendor-wallet.controller';
import { VendorWalletService } from './vendor-wallet.service';

/** Vendor portal: sub-order fulfilment (accept / ship / deliver) + wallet and ledger (T3.3). */
@Module({
  imports: [AuthModule],
  controllers: [VendorSubOrdersController, VendorWalletController],
  providers: [VendorSubOrdersService, VendorWalletService, VendorMembershipGuard],
})
export class VendorOrdersModule {}
