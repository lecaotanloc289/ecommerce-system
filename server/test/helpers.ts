import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { parseEnv, type Env } from '../src/config/env';
import {
  REFRESH_REUSE_GRACE_MS,
  type RefreshTokenStore,
  type RotateResult,
} from '../src/auth/refresh-token.store';

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
    JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
    GOOGLE_OAUTH_CLIENT_ID: 'google-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
    GOOGLE_OAUTH_CALLBACK_URL: 'http://localhost:3001/v1/auth/google/callback',
    FACEBOOK_OAUTH_CLIENT_ID: 'facebook-id',
    FACEBOOK_OAUTH_CLIENT_SECRET: 'facebook-secret',
    FACEBOOK_OAUTH_CALLBACK_URL: 'http://localhost:3001/v1/auth/facebook/callback',
    ...overrides,
  });
}

interface FamilyState {
  userId: string;
  current: string;
  ttl: number;
  prev?: string;
  rotatedAt?: number;
}

/** Same contract as RefreshTokenStore (grace window, reuse → delete family), backed by a Map. */
export class InMemoryRefreshTokenStore implements Pick<
  RefreshTokenStore,
  'createFamily' | 'rotate' | 'revokeFamily'
> {
  readonly families = new Map<string, FamilyState>();
  /** Test clock; advance past REFRESH_REUSE_GRACE_MS to make a replay count as reuse. */
  now: () => number = () => Date.now();

  async createFamily(familyId: string, userId: string, tokenHash: string, ttl: number) {
    this.families.set(familyId, { userId, current: tokenHash, ttl });
  }

  async rotate(
    familyId: string,
    presented: string,
    next: string,
    ttl: number,
  ): Promise<RotateResult> {
    const family = this.families.get(familyId);
    if (!family) return 'missing';
    const now = this.now();
    if (family.current === presented) {
      this.families.set(familyId, {
        ...family,
        current: next,
        prev: presented,
        rotatedAt: now,
        ttl,
      });
      return 'rotated';
    }
    if (
      family.prev === presented &&
      family.rotatedAt !== undefined &&
      now - family.rotatedAt <= REFRESH_REUSE_GRACE_MS
    ) {
      return 'grace';
    }
    this.families.delete(familyId);
    return 'reused';
  }

  async revokeFamily(familyId: string) {
    this.families.delete(familyId);
  }

  /** Move the clock past the grace window. */
  skipGraceWindow() {
    const later = Date.now() + REFRESH_REUSE_GRACE_MS + 1_000;
    this.now = () => later;
  }
}

export interface FakeRequest {
  headers: Record<string, string | undefined>;
  cookies: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  user?: unknown;
  oauthProfile?: unknown;
}

export function fakeRequest(partial: Partial<FakeRequest> = {}): FakeRequest {
  return { headers: {}, cookies: {}, query: {}, ...partial };
}

export function fakeReply() {
  return {
    setCookie: jest.fn(),
    clearCookie: jest.fn(),
    code: jest.fn(),
    send: jest.fn(),
    redirect: jest.fn(),
  };
}

export function httpContext(
  request: object,
  reply: object = fakeReply(),
  target?: { cls: new (...args: never[]) => object; handler: (...args: never[]) => unknown },
): ExecutionContextHost {
  const ctx = new ExecutionContextHost([request, reply], target?.cls, target?.handler);
  ctx.setType('http');
  return ctx;
}
