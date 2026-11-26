import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

// Throwaway Postgres (same image as docker-compose) + Redis containers on random host ports,
// started with the Docker CLI. `@testcontainers/*` is not resolvable from this workspace (see
// CLAUDE.md "Tests"); swap this file for Testcontainers once it is a devDependency here.
// Never touches the local dev DBs on 5432/5433.

const dbPackageDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../packages/db');

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
  }
}

function docker(...args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

function hostPort(containerId: string, containerPort: string): string {
  // e.g. "127.0.0.1:55012" (first line; IPv6 mappings may follow).
  const mapping = docker('port', containerId, containerPort).split('\n')[0] ?? '';
  const port = mapping.slice(mapping.lastIndexOf(':') + 1);
  if (!/^\d+$/.test(port)) throw new Error(`Unexpected docker port output: ${mapping}`);
  return port;
}

async function waitFor(what: string, check: () => void, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      check();
      return;
    } catch (err) {
      if (Date.now() > deadline)
        throw new Error(`${what} not ready in ${timeoutMs} ms`, { cause: err });
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

export default async function setup(project: TestProject): Promise<() => void> {
  const containers: string[] = [];
  const teardown = (): void => {
    for (const id of containers) {
      try {
        docker('rm', '-f', '-v', id);
      } catch {
        // already gone
      }
    }
  };

  try {
    const pg = docker(
      'run',
      '-d',
      '--rm',
      '-e',
      'POSTGRES_USER=postgres',
      '-e',
      'POSTGRES_PASSWORD=postgres',
      '-e',
      'POSTGRES_DB=outbox_test',
      '-p',
      '127.0.0.1::5432',
      'postgres:16-alpine',
    );
    containers.push(pg);
    const redis = docker('run', '-d', '--rm', '-p', '127.0.0.1::6379', 'redis:7-alpine');
    containers.push(redis);

    // TCP pg_isready: the entrypoint's temporary init server listens on the socket only.
    await waitFor('postgres', () =>
      docker('exec', pg, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'outbox_test'),
    );
    await waitFor('redis', () => {
      if (docker('exec', redis, 'redis-cli', 'ping') !== 'PONG') throw new Error('no PONG');
    });

    const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${hostPort(pg, '5432/tcp')}/outbox_test`;
    const redisUrl = `redis://127.0.0.1:${hostPort(redis, '6379/tcp')}`;

    execFileSync(resolve(dbPackageDir, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
      cwd: dbPackageDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        // Referenced by schema.prisma but unused by `migrate deploy`; must differ from the main
        // URL and must not fall back to packages/db/.env (the local dev DB).
        SHADOW_DATABASE_URL: databaseUrl.replace(/\/outbox_test$/, '/outbox_test_shadow'),
      },
    });

    project.provide('databaseUrl', databaseUrl);
    project.provide('redisUrl', redisUrl);
  } catch (err) {
    teardown();
    throw err;
  }
  return teardown;
}
