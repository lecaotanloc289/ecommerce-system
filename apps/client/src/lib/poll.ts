export interface PollOptions<T> {
  /** One attempt. Throwing aborts the poll (the caller maps it to an error state). */
  attempt: () => Promise<T>;
  /** True once `attempt`'s result is final and polling should stop. */
  isDone: (result: T) => boolean;
  intervalMs: number;
  timeoutMs: number;
  /** Aborting stops the poll with `{ kind: 'aborted' }`. */
  signal?: AbortSignal;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type PollResult<T> =
  | { kind: 'done'; value: T }
  | { kind: 'timeout'; last: T | null }
  | { kind: 'aborted' };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Call `attempt` every `intervalMs` until `isDone` or `timeoutMs` has elapsed. The first
 * attempt runs immediately; no attempt is started once the next one would fall past the deadline.
 */
export async function poll<T>(options: PollOptions<T>): Promise<PollResult<T>> {
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;
  for (;;) {
    if (options.signal?.aborted) return { kind: 'aborted' };
    const result = await options.attempt();
    if (options.signal?.aborted) return { kind: 'aborted' };
    if (options.isDone(result)) return { kind: 'done', value: result };
    if (now() + options.intervalMs > deadline) return { kind: 'timeout', last: result };
    await sleep(options.intervalMs);
  }
}
