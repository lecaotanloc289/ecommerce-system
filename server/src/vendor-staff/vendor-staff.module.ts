import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VendorMembershipGuard } from '../vendor/vendor-membership.guard';
import { VendorInvitationAcceptController, VendorStaffController } from './vendor-staff.controller';
import { VendorStaffService } from './vendor-staff.service';

/** Vendor staff invitations (T3.7): owner invites / revokes / removes, invitee accepts. */
@Module({
  imports: [AuthModule],
  controllers: [VendorStaffController, VendorInvitationAcceptController],
  providers: [VendorStaffService, VendorMembershipGuard],
})
export class VendorStaffModule {}
