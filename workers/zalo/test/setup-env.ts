import { inject } from 'vitest';

// Runs in each test worker before any test file is imported, so `@repo/db`'s Prisma singleton
// only ever sees the throwaway container DB.
process.env.DATABASE_URL = inject('databaseUrl');
process.env.REDIS_URL = inject('redisUrl');
