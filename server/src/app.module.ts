import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { CatalogModule } from './catalog/catalog.module';
import { DomainErrorFilter } from './common/domain-error.filter';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { MeModule } from './me/me.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { ReviewsModule } from './reviews/reviews.module';
import { StorageModule } from './storage/storage.module';
import { VendorApplicationsModule } from './vendor-applications/vendor-applications.module';
import { VendorModule } from './vendor/vendor.module';

const isDev = process.env.NODE_ENV !== 'production';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        ...(isDev && {
          transport: { target: 'pino-pretty', options: { singleLine: true } },
        }),
      },
    }),
    ConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    IdempotencyModule,
    MeModule,
    CartModule,
    CatalogModule,
    OrdersModule,
    ReviewsModule,
    StorageModule,
    VendorApplicationsModule,
    VendorModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
