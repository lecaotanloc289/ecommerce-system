import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AddressesService } from './addresses.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [AuthModule],
  controllers: [MeController],
  providers: [MeService, AddressesService],
})
export class MeModule {}
