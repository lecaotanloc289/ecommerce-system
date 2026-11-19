import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

/** Injection token for the shared ioredis client. */
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env): Redis => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
