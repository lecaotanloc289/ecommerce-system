import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformRefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformRefundsController],
  providers: [RefundsService],
})
export class RefundsModule {}
