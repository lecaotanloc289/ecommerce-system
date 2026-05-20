import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { HealthModule } from './health/health.module';

const isDev = process.env.NODE_ENV !== 'production';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        ...(isDev && {
          transport: { target: 'pino-pretty', options: { singleLine: true } },
        }),
      },
    }),
    HealthModule,
  ],
})
export class AppModule {}
