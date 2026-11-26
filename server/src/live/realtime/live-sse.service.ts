import type { OutgoingHttpHeaders } from 'node:http';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { DomainError, type LiveEvent, LiveSessionStatus } from '@repo/core';
import type { FastifyReply } from 'fastify';
import type { Subscription } from 'rxjs';
import { LiveSessionService } from '../live-session.service';
import { LIVE_REALTIME_OPTIONS, type LiveRealtimeOptions } from './live-realtime.options';
import { type LiveEventSubscription, LiveRealtimeService } from './live-realtime.service';
import { LiveViewersService } from './live-viewers.service';

/** A client this far behind (unsent bytes) is dropped instead of buffering without bound. */
const MAX_BUFFERED_BYTES = 256 * 1024;

/** After these the stream closes; a reconnecting EventSource then gets 404 and stops. */
const TERMINAL_EVENTS: ReadonlySet<LiveEvent['type']> = new Set([
  'session.ended',
  'session.cancelled',
]);

const STREAMABLE: ReadonlySet<LiveSessionStatus> = new Set([
  LiveSessionStatus.SCHEDULED,
  LiveSessionStatus.LIVE,
]);

/** `event: <type>` + `data: <json>` (JSON.stringify never emits a raw newline). */
export function formatSseEvent(event: LiveEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Server-Sent Events for `GET /live-sessions/:id/events` on Fastify.
 *
 * Written to the raw response after `reply.hijack()` (not Nest `@Sse()`): Nest's SSE helper
 * calls `writeHead` on the raw response itself and so drops headers that Fastify hooks queued
 * on the reply (CORS, helmet). Here those are copied from `reply.getHeaders()`, and every
 * failure that can happen before streaming (429, 404, Redis subscribe) still goes through the
 * normal exception filter because it happens before the hijack.
 *
 * Abuse limits (per instance; edge rate limiting is still expected in front): at most
 * `maxSseConnectionsPerIp` concurrent streams per client IP and `maxSseConnections` in total,
 * else 429 `common.error.rate-limited` before any lookup.
 *
 * The status is checked before AND after joining the event channel (a session that ends in
 * between would otherwise never reach this client), and re-read every
 * `sseStatusRecheckEveryPings` pings: the stream closes once the session is no longer
 * SCHEDULED/LIVE, even if its terminal event was lost.
 *
 * Per connection: viewer registration, `: ping` + score refresh every `pingIntervalMs`, events
 * from the instance-wide subscriber. Cleanup (idempotent) runs on client disconnect, write error,
 * terminal event, slow client, failed status re-check, or module destroy: stop the timer, leave
 * the local subscription, `ZREM` the viewer, free the connection slot, end the response.
 */
@Injectable()
export class LiveSseService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveSseService.name);
  private readonly open = new Set<() => Promise<void>>();
  private readonly connectionsByIp = new Map<string, number>();
  private connectionCount = 0;

  constructor(
    private readonly sessions: LiveSessionService,
    private readonly realtime: LiveRealtimeService,
    private readonly viewers: LiveViewersService,
    @Inject(LIVE_REALTIME_OPTIONS) private readonly options: LiveRealtimeOptions,
  ) {}

  async stream(sessionId: string, clientIp: string, reply: FastifyReply): Promise<void> {
    const releaseSlot = this.acquireSlot(clientIp);
    let subscription: LiveEventSubscription | null = null;
    try {
      await this.assertStreamable(sessionId);
      subscription = await this.realtime.join(sessionId);
      await this.assertStreamable(sessionId);
    } catch (error) {
      subscription?.leave();
      releaseSlot();
      throw error;
    }
    this.pipe(sessionId, subscription, releaseSlot, reply);
  }

  /** Concurrent streams on this instance (diagnostics / tests). */
  openStreamCount(): number {
    return this.connectionCount;
  }

  /** Ends every open stream so the HTTP server can close (SSE connections never go idle). */
  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.open].map((cleanup) => cleanup()));
  }

  private pipe(
    sessionId: string,
    subscription: LiveEventSubscription,
    releaseSlot: () => void,
    reply: FastifyReply,
  ): void {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      ...queuedHeaders(reply),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    });

    let isClosed = false;
    let events: Subscription | null = null;
    let timer: NodeJS.Timeout | null = null;
    let pings = 0;
    const viewer = this.viewers.connect(sessionId).catch((error: unknown) => {
      this.logger.warn({ err: error, sessionId }, 'live viewer register failed');
      return null;
    });

    const cleanup = async (): Promise<void> => {
      if (isClosed) return;
      isClosed = true;
      this.open.delete(cleanup);
      if (timer) clearInterval(timer);
      events?.unsubscribe();
      subscription.leave();
      releaseSlot();
      if (!raw.writableEnded) raw.end();
      const connectionId = await viewer;
      if (connectionId === null) return;
      try {
        await this.viewers.disconnect(sessionId, connectionId);
      } catch (error) {
        this.logger.warn({ err: error, sessionId }, 'live viewer unregister failed');
      }
    };
    const close = () => void cleanup();
    this.open.add(cleanup);
    raw.on('close', close);
    raw.on('error', close);
    // The client may have gone before the listeners were attached ('close' fires only once).
    if (raw.destroyed || raw.socket === null || raw.socket.destroyed) close();

    const write = (chunk: string): void => {
      if (isClosed || raw.writableEnded || raw.destroyed) return;
      if (raw.writableLength > MAX_BUFFERED_BYTES) {
        this.logger.warn({ sessionId }, 'live SSE client too slow — closing');
        close();
        return;
      }
      raw.write(chunk);
    };

    write(': connected\n\n');
    events = subscription.events.subscribe((event) => {
      write(formatSseEvent(event));
      if (TERMINAL_EVENTS.has(event.type)) close();
    });
    timer = setInterval(() => {
      write(': ping\n\n');
      void viewer.then((connectionId) => {
        if (connectionId === null || isClosed) return;
        return this.viewers.touch(sessionId, connectionId).catch((error: unknown) => {
          this.logger.warn({ err: error, sessionId }, 'live viewer refresh failed');
        });
      });
      pings += 1;
      if (pings % this.options.sseStatusRecheckEveryPings === 0) {
        void this.isStillStreamable(sessionId).then((isStreamable) => {
          if (!isStreamable) close();
        });
      }
    }, this.options.pingIntervalMs);
    timer.unref();
  }

  private async assertStreamable(sessionId: string): Promise<void> {
    const status = await this.sessions.getPublicStatus(sessionId);
    if (!STREAMABLE.has(status)) throw new DomainError('live.error.not-found');
  }

  /** false only when the session is definitely over / gone; DB errors keep the stream open. */
  private async isStillStreamable(sessionId: string): Promise<boolean> {
    try {
      await this.assertStreamable(sessionId);
      return true;
    } catch (error) {
      if (error instanceof DomainError) return false;
      this.logger.warn({ err: error, sessionId }, 'live SSE status re-check failed');
      return true;
    }
  }

  /** Reserves a connection slot (per IP + total) or throws 429. The release is idempotent. */
  private acquireSlot(clientIp: string): () => void {
    const perIp = this.connectionsByIp.get(clientIp) ?? 0;
    if (
      this.connectionCount >= this.options.maxSseConnections ||
      perIp >= this.options.maxSseConnectionsPerIp
    ) {
      this.logger.warn({ clientIp, perIp, total: this.connectionCount }, 'live SSE cap reached');
      throw new DomainError('common.error.rate-limited');
    }
    this.connectionsByIp.set(clientIp, perIp + 1);
    this.connectionCount += 1;

    let isReleased = false;
    return () => {
      if (isReleased) return;
      isReleased = true;
      this.connectionCount -= 1;
      const remaining = (this.connectionsByIp.get(clientIp) ?? 1) - 1;
      if (remaining <= 0) this.connectionsByIp.delete(clientIp);
      else this.connectionsByIp.set(clientIp, remaining);
    };
  }
}

/** Headers queued on the Fastify reply by hooks (CORS, helmet) — lost on a raw `writeHead`. */
function queuedHeaders(reply: FastifyReply): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) headers[name] = value;
  }
  return headers;
}
