import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument } from '../src/openapi/openapi';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS } from '../src/redis/redis.module';

/**
 * Writes `packages/sdk/openapi.json` without any live Postgres/Redis: the real AppModule is
 * built, but PrismaService and the Redis client are replaced by inert stubs and the env is a
 * fixed dummy (never read from the shell, so output is identical on every machine).
 * Nothing listens; the app only needs to be initialised so routes are registered.
 */
const DUMMY_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'openapi-export-access-secret-0123456789',
  JWT_REFRESH_SECRET: 'openapi-export-refresh-secret-0123456789',
  GOOGLE_OAUTH_CLIENT_ID: 'openapi-export',
  GOOGLE_OAUTH_CLIENT_SECRET: 'openapi-export',
  GOOGLE_OAUTH_CALLBACK_URL: 'http://localhost:3001/v1/auth/google/callback',
  FACEBOOK_OAUTH_CLIENT_ID: 'openapi-export',
  FACEBOOK_OAUTH_CLIENT_SECRET: 'openapi-export',
  FACEBOOK_OAUTH_CALLBACK_URL: 'http://localhost:3001/v1/auth/facebook/callback',
};

const OUTPUT_PATH = resolve(__dirname, '../../packages/sdk/openapi.json');

/** Recursively sorts object keys so the serialised document is deterministic. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, sortKeys(child)]),
    );
  }
  return value;
}

async function main(): Promise<void> {
  Object.assign(process.env, DUMMY_ENV);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ client: {} })
    .overrideProvider(REDIS)
    .useValue({ quit: () => Promise.resolve('OK') })
    .compile();

  const app = moduleRef.createNestApplication(new FastifyAdapter());
  app.setGlobalPrefix('v1');
  await app.init();
  const document = buildOpenApiDocument(app);
  await app.close();

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(sortKeys(document), null, 2)}\n`);
  process.stdout.write(`openapi: wrote ${OUTPUT_PATH}\n`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`openapi export failed: ${String(error)}\n`);
    process.exit(1);
  },
);
