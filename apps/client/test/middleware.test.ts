import { describe, expect, it } from 'vitest';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config } from '../src/middleware';

const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe('middleware matcher', () => {
  it('runs on locale-prefixed paths, dots included', () => {
    expect(matches('/vi')).toBe(true);
    expect(matches('/en/product/basic-tee')).toBe(true);
    expect(matches('/vi/product/x-4.5')).toBe(true);
  });

  it('runs on bare paths so they get the locale redirect — even with a dot in a slug', () => {
    expect(matches('/')).toBe(true);
    expect(matches('/cart')).toBe(true);
    expect(matches('/product/x-4.5')).toBe(true);
    expect(matches('/auth/callback')).toBe(true);
    expect(matches('/apiary')).toBe(true);
  });

  it('skips API routes, Next/Vercel internals and real static files', () => {
    expect(matches('/api/health')).toBe(false);
    expect(matches('/_next/static/chunks/app.js')).toBe(false);
    expect(matches('/_vercel/insights/script.js')).toBe(false);
    expect(matches('/favicon.ico')).toBe(false);
    expect(matches('/images/logo.svg')).toBe(false);
    expect(matches('/robots.txt')).toBe(false);
  });
});
