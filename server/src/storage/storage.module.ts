import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ENV } from '../config/config.module';
import { createS3Client, S3_CLIENT, StorageService } from './storage.service';
import { UploadsController } from './uploads.controller';

/** Export `StorageService` for features that validate (`assertOwnedKey`) or read (`presignGet`) keys. */
@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [{ provide: S3_CLIENT, inject: [ENV], useFactory: createS3Client }, StorageService],
  exports: [StorageService],
})
export class StorageModule {}
