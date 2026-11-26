import { inject } from 'vitest';

// Runs before each test file's imports: point the @repo/db Prisma singleton (reads DATABASE_URL
// when it connects) at the container from global-setup.ts.
process.env.DATABASE_URL = inject('databaseUrl');
