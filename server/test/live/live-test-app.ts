import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { type AuthUser, AuthUserSchema } from '../../src/auth/auth.schemas';
import { TokenService } from '../../src/auth/token.service';
import { DomainErrorFilter } from '../../src/common/domain-error.filter';
import { registerRawBodyCapture } from '../../src/common/raw-body';
import { ENV } from '../../src/config/config.module';
import type { Env } from '../../src/config/env';
import { LiveModule } from '../../src/live/live.module';
import { LiveSessionService } from '../../src/live/live-session.service';
import {
  DEFAULT_LIVE_REALTIME_OPTIONS,
  LIVE_REALTIME_OPTIONS,
  type LiveRealtimeOptions,
} from '../../src/live/realtime/live-realtime.options';
import { STREAM_PROVIDER } from '../../src/live/stream-provider.provider';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { REDIS, RedisModule } from '../../src/redis/redis.module';
import { FakeStreamProvider } from '@repo/streaming';
import cors from '@fastify/cors';
import Redis from 'ioredis';
import { ZodValidationPipe } from 'nestjs-zod';
import { pgTestEnv } from '../integration/pg';

export const NOTIFICATIONS_SECRET = 'notifications-secret-for-tests';
export const STREAM_SECRET = 'stream-webhook-secret-for-tests';

/**
 * Real LiveModule + Prisma (worker DB) + Redis (worker DB index), in-process Fastify with the
 * production raw-body capture. Only the stream provider is the in-memory fake.
 */
export async function createLiveTestApp(
  options: {
    devRoutes?: boolean;
    /** Faster realtime timers for tests (defaults = production values). */
    realtime?: Partial<LiveRealtimeOptions>;
    /** Register @fastify/cors like main.ts with this allowed origin. */
    corsOrigin?: string;
  } = {},
) {
  const env: Env = pgTestEnv({
    CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET: NOTIFICATIONS_SECRET,
    CLOUDFLARE_STREAM_WEBHOOK_SECRET: STREAM_SECRET,
  });
  const stream = new FakeStreamProvider();

  @Global()
  @Module({ providers: [{ provide: ENV, useValue: env }], exports: [ENV] })
  class TestConfigModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [
      TestConfigModule,
      PrismaModule,
      RedisModule,
      LiveModule.register({ devRoutes: options.devRoutes ?? false }),
    ],
    providers: [
      { provide: APP_PIPE, useClass: ZodValidationPipe },
      { provide: APP_FILTER, useClass: DomainErrorFilter },
    ],
  })
    .overrideProvider(STREAM_PROVIDER)
    .useValue(stream)
    .overrideProvider(LIVE_REALTIME_OPTIONS)
    .useValue({ ...DEFAULT_LIVE_REALTIME_OPTIONS, ...options.realtime })
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    logger: false,
  });
  app.setGlobalPrefix('v1');
  registerRawBodyCapture(app);
  if (options.corsOrigin !== undefined) {
    await app.register(cors, { origin: [options.corsOrigin], credentials: true });
  }
  try {
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  } catch (error) {
    await app.close(); // release Prisma/Redis so Jest can exit
    throw error;
  }

  const tokens = app.get(TokenService);
  return {
    app,
    env,
    stream,
    db: app.get(PrismaService).client,
    redis: app.get<Redis>(REDIS),
    service: app.get(LiveSessionService),
    /** `Authorization` header for a real access token built from the user's DB roles. */
    async authHeader(userId: string): Promise<{ authorization: string }> {
      const token = await tokens.issueAccessToken(userId);
      if (!token) throw new Error(`no user ${userId}`);
      return { authorization: `Bearer ${token.accessToken}` };
    },
  };
}

export type LiveTestApp = Awaited<ReturnType<typeof createLiveTestApp>>;

export function vendorUser(userId: string, vendorId: string, role = 'VENDOR_OWNER'): AuthUser {
  return AuthUserSchema.parse({ id: userId, roles: [role], vendorId });
}

/** Simulates the outbox worker's provisioning step (Task F) for a session. */
export async function provision(ctx: LiveTestApp, sessionId: string): Promise<string> {
  const { liveInputId } = await ctx.stream.createLiveInput({ liveSessionId: sessionId });
  await ctx.db.liveSession.update({ where: { id: sessionId }, data: { liveInputId } });
  return liveInputId;
}

export async function outboxEventTypes(ctx: LiveTestApp, sessionId: string): Promise<string[]> {
  const rows = await ctx.db.outboxEvent.findMany({
    where: { aggregateId: sessionId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { eventType: true },
  });
  return rows.map((row) => row.eventType);
}

/**
 * Collects every `live:*:events` message. Redis pub/sub ignores the DB index, so parallel
 * workers can see each other's events — always filter by session id.
 */
export async function captureLiveEvents(redisUrl: string) {
  const subscriber = new Redis(redisUrl);
  const events: { channel: string; event: { type: string; [key: string]: unknown } }[] = [];
  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    // Other workers' tests may publish junk on purpose (pub/sub crosses DB indexes): skip it.
    try {
      events.push({ channel, event: JSON.parse(message) });
    } catch {
      // not JSON — not one of ours
    }
  });
  await subscriber.psubscribe('live:*:events');
  return {
    /** Events of one session, waiting briefly for in-flight deliveries. */
    async forSession(sessionId: string, settleMs = 100) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
      return events.filter((e) => e.channel === `live:${sessionId}:events`).map((e) => e.event);
    },
    close: () => subscriber.quit(),
  };
}
