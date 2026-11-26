import { CurrencySchema } from '@repo/core';
import { ulid } from 'ulid';
import { createProduct, type TestVendor } from '../../integration/pg';
import { type LiveTestApp, provision, vendorUser } from '../live-test-app';

/** The singleton settings row (chat cooldown is read from it). */
export async function createPlatformSettings(ctx: LiveTestApp, liveChatCooldownSeconds = 2) {
  await ctx.db.platformSettings.create({
    data: {
      id: ulid(),
      liveChatCooldownSeconds,
      supportedCurrencies: [CurrencySchema.enum.VND],
    },
  });
}

/** A SCHEDULED session of the vendor (one product in the line-up). */
export async function scheduledSession(ctx: LiveTestApp, vendor: TestVendor) {
  const productId = await createProduct(ctx.db, vendor.vendorId);
  const owner = vendorUser(vendor.ownerId, vendor.vendorId);
  const { session } = await ctx.service.create(owner, ulid(), {
    title: 'Flash sale',
    scheduledAt: null,
    productIds: [productId],
  });
  return { sessionId: session.id, productId, owner };
}

/** A LIVE session: provisioned, encoder connected, went live. */
export async function liveSession(ctx: LiveTestApp, vendor: TestVendor) {
  const scheduled = await scheduledSession(ctx, vendor);
  const liveInputId = await provision(ctx, scheduled.sessionId);
  await ctx.service.applyEncoderEvent({ liveInputId, isConnected: true, occurredAt: new Date() });
  await ctx.service.goLive(scheduled.owner, scheduled.sessionId);
  return scheduled;
}

export interface SseFrame {
  event: string | null;
  data: string | null;
  comment: string | null;
}

/** Splits an SSE buffer into complete frames (blank-line separated). */
export function parseSseFrames(buffer: string): SseFrame[] {
  return buffer
    .split('\n\n')
    .slice(0, -1)
    .map((block) => {
      const frame: SseFrame = { event: null, data: null, comment: null };
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) frame.comment = line.slice(1).trim();
        else if (line.startsWith('event: ')) frame.event = line.slice('event: '.length);
        else if (line.startsWith('data: ')) frame.data = line.slice('data: '.length);
      }
      return frame;
    });
}

/** A streaming `fetch` of an SSE endpoint with a buffered reader. */
export async function openSse(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal, headers });
  const body = response.body;
  if (!body) throw new Error('no response body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let isDone = false;
  let pending: Promise<void> | null = null;

  const readOnce = (): Promise<void> => {
    pending ??= reader.read().then(
      ({ value, done }) => {
        pending = null;
        if (done) isDone = true;
        else buffer += decoder.decode(value, { stream: true });
      },
      () => {
        pending = null;
        isDone = true;
      },
    );
    return pending;
  };

  return {
    response,
    frames: () => parseSseFrames(buffer),
    isDone: () => isDone,
    /** Reads until `predicate(frames)` holds or the stream ends; throws after `timeoutMs`. */
    async waitFor(
      predicate: (frames: SseFrame[]) => boolean,
      timeoutMs = 5_000,
    ): Promise<SseFrame[]> {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(parseSseFrames(buffer))) {
        if (isDone) throw new Error(`stream ended before condition; got:\n${buffer}`);
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`timed out waiting for SSE frames; got:\n${buffer}`);
        await withTimeout(readOnce(), remaining);
      }
      return parseSseFrames(buffer);
    },
    /** Reads until the server ends the stream. */
    async waitForEnd(timeoutMs = 5_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (!isDone) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('timed out waiting for the stream to end');
        await withTimeout(readOnce(), remaining);
      }
    },
    close: () => controller.abort(),
  };
}

export function eventsOf(frames: SseFrame[], type: string): unknown[] {
  return frames
    .filter((frame) => frame.event === type && frame.data !== null)
    .map((frame) => JSON.parse(frame.data ?? 'null'));
}

/** Polls `check` until it returns true (Redis side effects of async cleanup). */
export async function eventually(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Waits for `promise` or `ms`, whichever comes first, without leaving a timer behind. */
async function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => (timer = setTimeout(resolve, ms))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
