import './global-setup';

/** Stops the containers started by global-setup.ts (same process, shared globalThis). */
export default async function globalTeardown(): Promise<void> {
  const containers = globalThis.__serverTestContainers;
  if (!containers) return;
  globalThis.__serverTestContainers = undefined;
  await Promise.all([containers.postgres.stop(), containers.redis.stop()]);
}
