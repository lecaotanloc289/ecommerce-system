import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { AppModule } from './app.module';
import { registerRawBodyCapture } from './common/raw-body';
import { registerRateLimit } from './common/rate-limit';
import { ENV } from './config/config.module';
import type { Env } from './config/env';
import { buildOpenApiDocument } from './openapi/openapi';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('v1');
  const env = app.get<Env>(ENV);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(cors, {
    origin: [env.WEB_ORIGIN, env.ADMIN_ORIGIN],
    credentials: true,
    exposedHeaders: ['retry-after', 'idempotent-replayed'],
  });
  await registerRateLimit(app);
  registerRawBodyCapture(app);

  // Swagger UI + raw spec only when NODE_ENV=development (the committed spec is
  // packages/sdk/openapi.json); staging/prod never expose it.
  if (env.NODE_ENV === 'development') {
    SwaggerModule.setup('docs', app, buildOpenApiDocument(app), {
      jsonDocumentUrl: 'v1/openapi.json',
    });
  }

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

void bootstrap();
