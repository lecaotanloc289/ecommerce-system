import './pg.harness-state';

export default async function globalTeardown(): Promise<void> {
  const containers = globalThis.__pgHarnessContainers ?? [];
  globalThis.__pgHarnessContainers = undefined;
  await Promise.all(containers.map((container) => container.stop()));
}
