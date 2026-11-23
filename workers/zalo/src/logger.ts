import { pino, type Logger } from 'pino';
import type { Env } from './env.js';

export type { Logger };

export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Logger {
  return pino({
    name: 'zalo-worker',
    level: env.LOG_LEVEL,
    // Never log zca-js credentials or cookies.
    redact: ['credentials', 'cookie', '*.cookie', '*.credentials'],
    // pino-pretty is a devDependency — only load it in local dev.
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  });
}
