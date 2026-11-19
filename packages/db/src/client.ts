import { PrismaClient } from '@prisma/client';

// Singleton — guarded against hot-reload duplication in dev.
// Typed cache cast avoids the constitution-banned `as unknown as`.
const globalForPrisma = globalThis as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
