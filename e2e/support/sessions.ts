import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { BrowserContext } from '@playwright/test';
import { type AccountKey, ACCOUNTS, RUN_ENV, requireRunEnv } from './config';

// The refresh cookie (HttpOnly, Secure, SameSite=Lax, Path=/v1/auth) is host-scoped, so a cookie
// for `localhost` reaches the API on its own port from both the storefront and the admin origin.
// Planting a minted refresh token makes each app's normal boot-time `POST /v1/auth/refresh`
// sign the user in — the exact production path, minus the OAuth redirect.

type Minted = Record<string, string[]>;

function usedFile(): string {
  return `${requireRunEnv(RUN_ENV.sessionsFile)}.used`;
}

/** Hands out each minted token once (a refresh token must not be shared by two browser contexts). */
function nextToken(email: string): string {
  const minted = JSON.parse(readFileSync(requireRunEnv(RUN_ENV.sessionsFile), 'utf8')) as Minted;
  const used: Record<string, number> = existsSync(usedFile())
    ? (JSON.parse(readFileSync(usedFile(), 'utf8')) as Record<string, number>)
    : {};
  const index = used[email] ?? 0;
  const token = minted[email]?.[index];
  if (token === undefined) throw new Error(`no minted session left for ${email}`);
  used[email] = index + 1;
  writeFileSync(usedFile(), JSON.stringify(used));
  return token;
}

/** Signs `account` in on this browser context (both apps share the cookie). */
export async function signIn(context: BrowserContext, account: AccountKey): Promise<void> {
  await context.addCookies([
    {
      name: 'refresh_token',
      value: nextToken(ACCOUNTS[account]),
      domain: 'localhost',
      path: '/v1/auth',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}
