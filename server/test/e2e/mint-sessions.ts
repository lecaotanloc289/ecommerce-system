import 'reflect-metadata';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { RefreshTokenStore } from '../../src/auth/refresh-token.store';
import { TokenService } from '../../src/auth/token.service';
import { parseEnv } from '../../src/config/env';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * E2E-only session minter (T6.1). OAuth cannot run in a browser test, so this starts real login
 * sessions for seeded users through the API's own `TokenService.startSession` — a new token
 * family in Redis plus a signed refresh JWT — and prints the refresh tokens. The Playwright
 * suite plants one as the `refresh_token` cookie (path `/v1/auth`), after which the apps' normal
 * silent `POST /v1/auth/refresh` signs the user in.
 *
 * Lives under `server/test/` on purpose: it is never part of the production build, and no HTTP
 * route is added. It also refuses to run when NODE_ENV=production.
 *
 * Usage (env = the API's env: DATABASE_URL, REDIS_URL, JWT_*, …):
 *   ts-node … test/e2e/mint-sessions.ts <sessionsPerUser> <email> [<email> …]
 * Output: one JSON object on stdout, `{ "<email>": ["<refresh token>", …] }`.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('mint-sessions refuses to run with NODE_ENV=production');
  }
  // Explicit opt-in (set only by e2e/scripts/run.ts) and only against a throwaway e2e database,
  // so shell secrets for a real environment can never be used to mint sessions by accident.
  const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/none').pathname;
  if (process.env.E2E_MINT_SESSIONS !== '1' || !/^\/e2e_[0-9a-f]{8}$/.test(database)) {
    throw new Error('mint-sessions only runs for the throwaway e2e database (via `pnpm e2e`)');
  }
  const [countArg, ...emails] = process.argv.slice(2);
  const perUser = Number(countArg);
  if (!Number.isInteger(perUser) || perUser < 1 || emails.length === 0) {
    throw new Error('usage: mint-sessions <sessionsPerUser> <email> [<email> …]');
  }

  const env = parseEnv(process.env);
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  const tokens = new TokenService(prisma, new JwtService(), new RefreshTokenStore(redis), env);

  try {
    const result: Record<string, string[]> = {};
    for (const email of emails) {
      const user = await prisma.client.user.findUnique({
        where: { email: email.toLowerCase() },
        select: { id: true },
      });
      if (!user) throw new Error(`no seeded user with email ${email}`);
      const sessions: string[] = [];
      for (let i = 0; i < perUser; i += 1) sessions.push(await tokens.startSession(user.id));
      result[email] = sessions;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await redis.quit();
    await prisma.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
