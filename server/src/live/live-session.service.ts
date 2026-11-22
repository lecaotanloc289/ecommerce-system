import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateLiveSession,
  DomainError,
  IdempotencyKeySchema,
  type LiveEndReason,
  type LiveIngestCredentials,
  LiveIngestCredentialsSchema,
  type LiveSession,
  LiveSessionStatus,
  ProductStatus,
  type ReplaceLiveSessionProducts,
  Role,
  type VendorLiveSession,
  VendorStatus,
} from '@repo/core';
import type { Prisma } from '@repo/db';
import { isStreamProviderError, type StreamProvider } from '@repo/streaming';
import type Redis from 'ioredis';
import { ulid } from 'ulid';
import type { AuthUser } from '../auth/auth.schemas';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { LiveEventsPublisher } from './live-events.publisher';
import { liveOutboxRow } from './live-outbox';
import { LIVE_ENDED_KEY_TTL_SECONDS, liveKeys, liveKeysExpiringOnEnd } from './live-redis-keys';
import {
  LIVE_SESSION_INCLUDE,
  LiveSessionMapper,
  type LiveSessionRow,
} from './live-session.mapper';
import { STREAM_PROVIDER } from './stream-provider.provider';

type Tx = Prisma.TransactionClient;

const VENDOR_ROLES: Role[] = [Role.VENDOR_OWNER, Role.VENDOR_STAFF];
/** Line-up / pin / ingest are allowed only before and during the broadcast. */
const OPEN_STATUSES: LiveSessionStatus[] = [LiveSessionStatus.SCHEDULED, LiveSessionStatus.LIVE];
const LIST_LIMIT = 100;
/**
 * Encoder events stamped further in the future than this are clamped to "now": a bad provider
 * timestamp must not freeze the encoder state (later real events would all look stale).
 */
const MAX_ENCODER_CLOCK_SKEW_MS = 60_000;

/** Statuses the public listing accepts (never CANCELLED). */
const PUBLIC_LIST_STATUSES: ReadonlySet<LiveSessionStatus> = new Set([
  LiveSessionStatus.SCHEDULED,
  LiveSessionStatus.LIVE,
  LiveSessionStatus.ENDED,
]);

export interface CreateLiveSessionResult {
  session: VendorLiveSession;
  /** false = idempotent replay of an earlier create with the same key. */
  isCreated: boolean;
}

export interface EncoderEvent {
  liveInputId: string;
  isConnected: boolean;
  occurredAt: Date;
}

/** `applied` = state changed; `stale` = older than the last applied event or session closed. */
export type EncoderEventOutcome = 'applied' | 'stale' | 'unknown-input';

interface TransitionResult {
  row: LiveSessionRow;
  isChanged: boolean;
}

/**
 * Live sessions: vendor CRUD-by-use-case, the state machine (plan §1.8), public/platform reads and
 * the encoder/recording updates driven by provider webhooks.
 *
 * Every transition is one `$transaction`: a guarded `updateMany` (count 0 ⇒ re-read: already in
 * the target state ⇒ idempotent success, else a specific error) + its outbox row. Redis events
 * are published only after commit. Vendor scope always comes from the DB-verified caller, never
 * from the request.
 */
@Injectable()
export class LiveSessionService {
  private readonly logger = new Logger(LiveSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: LiveSessionMapper,
    private readonly publisher: LiveEventsPublisher,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(STREAM_PROVIDER) private readonly stream: StreamProvider,
  ) {}

  // ------------------------------------------------------------------ vendor

  async create(
    user: AuthUser,
    rawIdempotencyKey: string | undefined,
    input: CreateLiveSession,
  ): Promise<CreateLiveSessionResult> {
    const key = IdempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!key.success) throw new DomainError('idempotency.error.key-required');
    const vendorId = await this.requireActiveVendor(user);

    const existing = await this.findByIdempotencyKey(vendorId, key.data);
    if (existing) return { session: this.replayOf(existing, input), isCreated: false };

    const id = ulid();
    try {
      const row = await this.prisma.client.$transaction(async (tx) => {
        await this.assertProductsUsable(tx, vendorId, input.productIds);
        const created = await tx.liveSession.create({
          data: {
            id,
            vendorId,
            createdById: user.id,
            idempotencyKey: key.data,
            title: input.title,
            scheduledAt: input.scheduledAt === null ? null : new Date(input.scheduledAt),
            products: {
              create: input.productIds.map((productId, position) => ({ productId, position })),
            },
          },
          include: LIVE_SESSION_INCLUDE,
        });
        await tx.outboxEvent.create({
          data: liveOutboxRow({
            eventType: 'live_session.provision_requested',
            payload: { liveSessionId: id },
          }),
        });
        return created;
      });
      return { session: this.mapper.toVendor(row), isCreated: true };
    } catch (error) {
      // A concurrent request with the same key committed first → replay its result.
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findByIdempotencyKey(vendorId, key.data);
      if (!raced) throw error;
      return { session: this.replayOf(raced, input), isCreated: false };
    }
  }

  async listForVendor(user: AuthUser, status?: LiveSessionStatus): Promise<VendorLiveSession[]> {
    const vendorId = await this.requireActiveVendor(user);
    const rows = await this.prisma.client.liveSession.findMany({
      where: { vendorId, ...(status !== undefined && { status }) },
      include: LIVE_SESSION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT,
    });
    return rows.map((row) => this.mapper.toVendor(row));
  }

  async getForVendor(user: AuthUser, id: string): Promise<VendorLiveSession> {
    const vendorId = await this.requireActiveVendor(user);
    return this.mapper.toVendor(await this.findOwned(vendorId, id));
  }

  /**
   * RTMPS URL + stream key, fetched from the provider on demand and never stored (decision D2).
   * This read-only provider call is the one documented exception to Golden Rule #9 ("no
   * external call in the request thread"): it changes nothing and the vendor needs the key now.
   */
  async getIngestCredentials(user: AuthUser, id: string): Promise<LiveIngestCredentials> {
    const vendorId = await this.requireActiveVendor(user);
    const row = await this.findOwned(vendorId, id);
    if (!OPEN_STATUSES.includes(row.status)) throw new DomainError('live.error.invalid-transition');
    if (row.liveInputId === null) throw new DomainError('live.error.not-provisioned');

    try {
      const credentials = await this.stream.getIngestCredentials(row.liveInputId);
      return LiveIngestCredentialsSchema.parse(credentials);
    } catch (error) {
      if (!isStreamProviderError(error)) throw error;
      this.logger.warn(
        { sessionId: id, status: error.status, retryable: error.retryable, err: error.message },
        'stream provider ingest-credentials failed',
      );
      throw new DomainError('live.error.stream-provider-unavailable');
    }
  }

  /** Replaces the line-up (array order = position); keeps `pinnedAt` of products still present. */
  async replaceProducts(
    user: AuthUser,
    id: string,
    input: ReplaceLiveSessionProducts,
  ): Promise<VendorLiveSession> {
    const vendorId = await this.requireActiveVendor(user);
    const row = await this.prisma.client.$transaction(async (tx) => {
      await this.lockOpenSession(tx, vendorId, id);
      await this.assertProductsUsable(tx, vendorId, input.productIds);
      const current = await tx.liveSessionProduct.findMany({
        where: { liveSessionId: id },
        select: { productId: true, pinnedAt: true },
      });
      const pinnedAt = new Map(current.map((product) => [product.productId, product.pinnedAt]));
      await tx.liveSessionProduct.deleteMany({ where: { liveSessionId: id } });
      await tx.liveSessionProduct.createMany({
        data: input.productIds.map((productId, position) => ({
          liveSessionId: id,
          productId,
          position,
          pinnedAt: pinnedAt.get(productId) ?? null,
        })),
      });
      return tx.liveSession.findUniqueOrThrow({ where: { id }, include: LIVE_SESSION_INCLUDE });
    });

    const session = this.mapper.toVendor(row);
    await this.publisher.publish({
      type: 'products.updated',
      sessionId: session.id,
      products: session.products,
    });
    return session;
  }

  /** Pins one product of the line-up (unpinning any other). Idempotent. */
  async pinProduct(user: AuthUser, id: string, productId: string): Promise<VendorLiveSession> {
    const vendorId = await this.requireActiveVendor(user);
    const { row, isChanged } = await this.prisma.client.$transaction(async (tx) => {
      await this.lockOpenSession(tx, vendorId, id);
      const target = await this.findLineupProduct(tx, id, productId);
      if (target.pinnedAt === null) {
        // Unpin first: the partial unique index allows one pinned product per session.
        await tx.liveSessionProduct.updateMany({
          where: { liveSessionId: id, pinnedAt: { not: null } },
          data: { pinnedAt: null },
        });
        await tx.liveSessionProduct.update({
          where: { liveSessionId_productId: { liveSessionId: id, productId } },
          data: { pinnedAt: new Date() },
        });
      }
      return {
        row: await tx.liveSession.findUniqueOrThrow({
          where: { id },
          include: LIVE_SESSION_INCLUDE,
        }),
        isChanged: target.pinnedAt === null,
      };
    });

    const session = this.mapper.toVendor(row);
    const pinned = session.products.find((product) => product.productId === productId);
    if (isChanged && pinned?.pinnedAt) {
      await this.publisher.publish({
        type: 'product.pinned',
        sessionId: session.id,
        productId,
        pinnedAt: pinned.pinnedAt,
      });
    }
    return session;
  }

  /** Unpins a product of the line-up. Idempotent. */
  async unpinProduct(user: AuthUser, id: string, productId: string): Promise<VendorLiveSession> {
    const vendorId = await this.requireActiveVendor(user);
    const { row, isChanged } = await this.prisma.client.$transaction(async (tx) => {
      await this.lockOpenSession(tx, vendorId, id);
      const target = await this.findLineupProduct(tx, id, productId);
      if (target.pinnedAt !== null) {
        await tx.liveSessionProduct.update({
          where: { liveSessionId_productId: { liveSessionId: id, productId } },
          data: { pinnedAt: null },
        });
      }
      return {
        row: await tx.liveSession.findUniqueOrThrow({
          where: { id },
          include: LIVE_SESSION_INCLUDE,
        }),
        isChanged: target.pinnedAt !== null,
      };
    });

    const session = this.mapper.toVendor(row);
    if (isChanged) {
      await this.publisher.publish({ type: 'product.unpinned', sessionId: session.id, productId });
    }
    return session;
  }

  /** SCHEDULED → LIVE. Needs a provisioned input and a connected encoder; one LIVE per vendor. */
  async goLive(user: AuthUser, id: string): Promise<VendorLiveSession> {
    const vendorId = await this.requireActiveVendor(user);
    const startedAt = new Date();
    let result: TransitionResult;
    try {
      result = await this.prisma.client.$transaction(async (tx) => {
        const { count } = await tx.liveSession.updateMany({
          where: {
            id,
            vendorId,
            status: LiveSessionStatus.SCHEDULED,
            liveInputId: { not: null },
            encoderConnectedAt: { not: null },
          },
          data: { status: LiveSessionStatus.LIVE, startedAt },
        });
        const row = await this.findOwnedIn(tx, vendorId, id);
        if (count === 0) {
          if (row.status === LiveSessionStatus.LIVE) return { row, isChanged: false };
          if (row.status === LiveSessionStatus.SCHEDULED && row.liveInputId === null) {
            throw new DomainError('live.error.not-provisioned');
          }
          if (row.status === LiveSessionStatus.SCHEDULED && row.encoderConnectedAt === null) {
            throw new DomainError('live.error.encoder-offline');
          }
          throw new DomainError('live.error.invalid-transition');
        }
        await tx.outboxEvent.create({
          data: liveOutboxRow({
            eventType: 'live_session.started',
            payload: { liveSessionId: id, vendorId, startedAt: startedAt.toISOString() },
          }),
        });
        return { row, isChanged: true };
      });
    } catch (error) {
      // live_sessions_one_live_per_vendor_key: this vendor already has another LIVE session.
      if (isUniqueViolation(error)) throw new DomainError('live.error.already-live');
      throw error;
    }

    const session = this.mapper.toVendor(result.row);
    if (result.isChanged && session.startedAt) {
      await this.publisher.publish({
        type: 'session.live',
        sessionId: session.id,
        startedAt: session.startedAt,
      });
    }
    return session;
  }

  /** LIVE → ENDED by the vendor. */
  async end(user: AuthUser, id: string): Promise<VendorLiveSession> {
    const vendorId = await this.requireActiveVendor(user);
    return this.endLive({ id, vendorId }, 'VENDOR', null);
  }

  /** SCHEDULED → CANCELLED. */
  async cancel(user: AuthUser, id: string): Promise<VendorLiveSession> {
    const vendorId = await this.requireActiveVendor(user);
    const result = await this.prisma.client.$transaction(async (tx): Promise<TransitionResult> => {
      const { count } = await tx.liveSession.updateMany({
        where: { id, vendorId, status: LiveSessionStatus.SCHEDULED },
        data: { status: LiveSessionStatus.CANCELLED },
      });
      const row = await this.findOwnedIn(tx, vendorId, id);
      if (count === 0) {
        if (row.status === LiveSessionStatus.CANCELLED) return { row, isChanged: false };
        throw new DomainError('live.error.invalid-transition');
      }
      await tx.outboxEvent.create({
        data: liveOutboxRow({
          eventType: 'live_session.cancelled',
          payload: { liveSessionId: id, liveInputId: row.liveInputId },
        }),
      });
      return { row, isChanged: true };
    });

    const session = this.mapper.toVendor(result.row);
    if (result.isChanged) {
      await this.publisher.publish({ type: 'session.cancelled', sessionId: session.id });
    }
    return session;
  }

  /** Dev-only (fake provider): same path as the live-input webhook, `occurredAt = now`. */
  async simulateEncoder(
    user: AuthUser,
    id: string,
    isConnected: boolean,
  ): Promise<VendorLiveSession> {
    const vendorId = await this.requireActiveVendor(user);
    const row = await this.findOwned(vendorId, id);
    if (row.liveInputId === null) throw new DomainError('live.error.not-provisioned');
    await this.applyEncoderEvent({
      liveInputId: row.liveInputId,
      isConnected,
      occurredAt: new Date(),
    });
    return this.mapper.toVendor(await this.findOwned(vendorId, id));
  }

  // ------------------------------------------------------------------ public

  /** Public listing: default LIVE; SCHEDULED / LIVE / ENDED-with-recording; never CANCELLED. */
  async listPublic(status: LiveSessionStatus = LiveSessionStatus.LIVE): Promise<LiveSession[]> {
    if (!PUBLIC_LIST_STATUSES.has(status)) throw new DomainError('common.error.validation-failed');
    const orderBy: Prisma.LiveSessionOrderByWithRelationInput[] =
      status === LiveSessionStatus.SCHEDULED
        ? [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]
        : status === LiveSessionStatus.LIVE
          ? [{ startedAt: 'desc' }]
          : [{ endedAt: 'desc' }];
    const rows = await this.prisma.client.liveSession.findMany({
      where: {
        status,
        vendor: { status: VendorStatus.ACTIVE },
        ...(status === LiveSessionStatus.ENDED && { recordingVideoId: { not: null } }),
      },
      include: LIVE_SESSION_INCLUDE,
      orderBy: [...orderBy, { id: 'desc' }],
      take: LIST_LIMIT,
    });
    return rows.map((row) => this.mapper.toPublic(row));
  }

  /** 404 for CANCELLED sessions and sessions of non-ACTIVE vendors. */
  async getPublic(id: string): Promise<LiveSession> {
    const row = await this.prisma.client.liveSession.findFirst({
      where: {
        id,
        status: { not: LiveSessionStatus.CANCELLED },
        vendor: { status: VendorStatus.ACTIVE },
      },
      include: LIVE_SESSION_INCLUDE,
    });
    if (!row) throw new DomainError('live.error.not-found');
    return this.mapper.toPublic(row);
  }

  /**
   * Status of a publicly visible session (same visibility as `getPublic`: not CANCELLED, vendor
   * ACTIVE) — the gate for realtime reads/writes. Anything else → `live.error.not-found`.
   */
  async getPublicStatus(id: string): Promise<LiveSessionStatus> {
    const row = await this.prisma.client.liveSession.findFirst({
      where: {
        id,
        status: { not: LiveSessionStatus.CANCELLED },
        vendor: { status: VendorStatus.ACTIVE },
      },
      select: { status: true },
    });
    if (!row) throw new DomainError('live.error.not-found');
    return row.status;
  }

  /** Status of the caller's own session (DB-verified vendor scope; other vendor's → 404). */
  async getOwnedStatus(user: AuthUser, id: string): Promise<LiveSessionStatus> {
    const vendorId = await this.requireActiveVendor(user);
    const row = await this.prisma.client.liveSession.findFirst({
      where: { id, vendorId },
      select: { status: true },
    });
    if (!row) throw new DomainError('live.error.not-found');
    return row.status;
  }

  // ------------------------------------------------------------------ platform

  async listForPlatform(status?: LiveSessionStatus): Promise<VendorLiveSession[]> {
    const rows = await this.prisma.client.liveSession.findMany({
      where: status === undefined ? {} : { status },
      include: LIVE_SESSION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_LIMIT,
    });
    return rows.map((row) => this.mapper.toVendor(row));
  }

  /** LIVE → ENDED by platform staff (`TERMINATED`, reason kept as `endNote`). */
  terminate(id: string, reason: string): Promise<VendorLiveSession> {
    return this.endLive({ id }, 'TERMINATED', reason);
  }

  // ------------------------------------------------------------------ provider webhooks

  /**
   * Applies an encoder connect/disconnect (plan §1.8): only for SCHEDULED/LIVE sessions and only
   * when `occurredAt` is newer than the last applied event (out-of-order / replay safe). A
   * disconnect while LIVE also writes `live_session.encoder_disconnected` (grace timer).
   */
  async applyEncoderEvent(event: EncoderEvent): Promise<EncoderEventOutcome> {
    const target = await this.prisma.client.liveSession.findUnique({
      where: { liveInputId: event.liveInputId },
      select: { id: true },
    });
    if (!target) return 'unknown-input';
    const { isConnected } = event;
    const occurredAt = this.clampOccurredAt(event, target.id);

    const isApplied = await this.prisma.client.$transaction(async (tx) => {
      const { count } = await tx.liveSession.updateMany({
        where: {
          id: target.id,
          status: { in: OPEN_STATUSES },
          OR: [{ encoderStatusAt: null }, { encoderStatusAt: { lt: occurredAt } }],
        },
        data: isConnected
          ? {
              encoderConnectedAt: occurredAt,
              encoderDisconnectedAt: null,
              encoderStatusAt: occurredAt,
            }
          : {
              encoderConnectedAt: null,
              encoderDisconnectedAt: occurredAt,
              encoderStatusAt: occurredAt,
            },
      });
      if (count === 0) return false;
      // The UPDATE holds the row lock until commit, so this status cannot change under us.
      const { status } = await tx.liveSession.findUniqueOrThrow({
        where: { id: target.id },
        select: { status: true },
      });
      if (!isConnected && status === LiveSessionStatus.LIVE) {
        await tx.outboxEvent.create({
          data: liveOutboxRow({
            eventType: 'live_session.encoder_disconnected',
            payload: { liveSessionId: target.id, disconnectedAt: occurredAt.toISOString() },
          }),
        });
      }
      return true;
    });

    if (!isApplied) return 'stale';
    await this.publisher.publish({ type: 'encoder.status', sessionId: target.id, isConnected });
    return 'applied';
  }

  /**
   * Stream video webhook: the first ready recording of a live input becomes the session's
   * replay. Returns false when the input is unknown or a recording is already attached.
   */
  async attachRecording(liveInputId: string, videoId: string): Promise<boolean> {
    const { count } = await this.prisma.client.liveSession.updateMany({
      where: { liveInputId, recordingVideoId: null },
      data: { recordingVideoId: videoId },
    });
    if (count === 0) return false;
    const row = await this.prisma.client.liveSession.findUnique({
      where: { liveInputId },
      select: { id: true },
    });
    if (row) await this.publisher.publish({ type: 'recording.ready', sessionId: row.id });
    return true;
  }

  // ------------------------------------------------------------------ internals

  /**
   * The caller's vendor, re-verified in the DB (the access token may be up to 15 min stale):
   * the user must still hold a vendor role for it and the vendor must be ACTIVE.
   */
  private async requireActiveVendor(user: AuthUser): Promise<string> {
    if (user.vendorId === undefined) throw new DomainError('vendor.error.not-active');
    const role = await this.prisma.client.userRole.findFirst({
      where: {
        userId: user.id,
        vendorId: user.vendorId,
        role: { in: VENDOR_ROLES },
        vendor: { status: VendorStatus.ACTIVE },
      },
      select: { id: true },
    });
    if (!role) throw new DomainError('vendor.error.not-active');
    return user.vendorId;
  }

  /**
   * An idempotent replay must carry the same request: title, scheduledAt and the line-up (in
   * order) are compared with the stored session, else `idempotency.error.key-reused`. A correct
   * client only edits the line-up after receiving the create response, so a genuine retry always
   * matches the original line-up.
   */
  private replayOf(row: LiveSessionRow, input: CreateLiveSession): VendorLiveSession {
    const scheduledAt = input.scheduledAt === null ? null : new Date(input.scheduledAt).getTime();
    const lineup = row.products.map((product) => product.productId);
    const isSame =
      row.title === input.title &&
      (row.scheduledAt?.getTime() ?? null) === scheduledAt &&
      lineup.length === input.productIds.length &&
      lineup.every((productId, index) => productId === input.productIds[index]);
    if (!isSame) throw new DomainError('idempotency.error.key-reused');
    return this.mapper.toVendor(row);
  }

  private clampOccurredAt(event: EncoderEvent, sessionId: string): Date {
    const now = Date.now();
    if (event.occurredAt.getTime() <= now + MAX_ENCODER_CLOCK_SKEW_MS) return event.occurredAt;
    this.logger.warn(
      { sessionId, liveInputId: event.liveInputId, occurredAt: event.occurredAt.toISOString() },
      'encoder event timestamp too far in the future — using now',
    );
    return new Date(now);
  }

  private findByIdempotencyKey(vendorId: string, idempotencyKey: string) {
    return this.prisma.client.liveSession.findUnique({
      where: { vendorId_idempotencyKey: { vendorId, idempotencyKey } },
      include: LIVE_SESSION_INCLUDE,
    });
  }

  /** Another vendor's session is indistinguishable from a missing one (404). */
  private findOwned(vendorId: string, id: string): Promise<LiveSessionRow> {
    return this.findOwnedIn(this.prisma.client, vendorId, id);
  }

  private async findOwnedIn(client: Tx, vendorId: string, id: string): Promise<LiveSessionRow> {
    const row = await client.liveSession.findFirst({
      where: { id, vendorId },
      include: LIVE_SESSION_INCLUDE,
    });
    if (!row) throw new DomainError('live.error.not-found');
    return row;
  }

  /**
   * Guards an edit of an open (SCHEDULED/LIVE) own session and row-locks it for the rest of the
   * transaction, so a concurrent end/cancel serialises behind the edit.
   */
  private async lockOpenSession(tx: Tx, vendorId: string, id: string): Promise<void> {
    const { count } = await tx.liveSession.updateMany({
      where: { id, vendorId, status: { in: OPEN_STATUSES } },
      data: { updatedAt: new Date() },
    });
    if (count === 1) return;
    await this.findOwnedIn(tx, vendorId, id); // 404 if not own
    throw new DomainError('live.error.invalid-transition');
  }

  private async findLineupProduct(tx: Tx, liveSessionId: string, productId: string) {
    const product = await tx.liveSessionProduct.findUnique({
      where: { liveSessionId_productId: { liveSessionId, productId } },
      select: { pinnedAt: true },
    });
    if (!product) throw new DomainError('product.error.not-found');
    return product;
  }

  /** Every product must belong to the caller's vendor and be ACTIVE. */
  private async assertProductsUsable(
    tx: Tx,
    vendorId: string,
    productIds: readonly string[],
  ): Promise<void> {
    if (productIds.length === 0) return;
    const rows = await tx.product.findMany({
      where: { id: { in: [...productIds] } },
      select: { id: true, vendorId: true, status: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const productId of productIds) {
      const product = byId.get(productId);
      // A foreign product is reported like a missing one — no cross-vendor existence leak.
      if (product?.vendorId !== vendorId) {
        throw new DomainError('live.error.product-not-owned', { productId });
      }
      if (product.status !== ProductStatus.ACTIVE) {
        throw new DomainError('live.error.product-inactive', { productId });
      }
    }
  }

  /** LIVE → ENDED (vendor or platform). Peak viewers = max(db, Redis `live:{id}:peak`). */
  private async endLive(
    scope: { id: string; vendorId?: string },
    endReason: LiveEndReason,
    endNote: string | null,
  ): Promise<VendorLiveSession> {
    const where: Prisma.LiveSessionWhereInput = {
      id: scope.id,
      ...(scope.vendorId !== undefined && { vendorId: scope.vendorId }),
    };
    const redisPeak = await this.readPeakViewers(scope.id);
    const endedAt = new Date();

    const result = await this.prisma.client.$transaction(async (tx): Promise<TransitionResult> => {
      const before = await tx.liveSession.findFirst({ where, select: { peakViewers: true } });
      if (!before) throw new DomainError('live.error.not-found');
      const { count } = await tx.liveSession.updateMany({
        where: { ...where, status: LiveSessionStatus.LIVE },
        data: {
          status: LiveSessionStatus.ENDED,
          endedAt,
          endReason,
          endNote,
          peakViewers: Math.max(before.peakViewers, redisPeak),
        },
      });
      const row = await tx.liveSession.findFirstOrThrow({ where, include: LIVE_SESSION_INCLUDE });
      if (count === 0) {
        if (row.status === LiveSessionStatus.ENDED) return { row, isChanged: false };
        throw new DomainError('live.error.invalid-transition');
      }
      await tx.outboxEvent.create({
        data: liveOutboxRow({
          eventType: 'live_session.ended',
          payload: {
            liveSessionId: row.id,
            vendorId: row.vendorId,
            liveInputId: row.liveInputId,
            endReason,
          },
        }),
      });
      return { row, isChanged: true };
    });

    const session = this.mapper.toVendor(result.row);
    if (result.isChanged) {
      await this.publisher.publish({
        type: 'session.ended',
        sessionId: session.id,
        endedAt: endedAt.toISOString(),
        endReason,
      });
      await this.expireRealtimeKeys(session.id);
    }
    return session;
  }

  /** Best-effort: Redis down must not block ending a broadcast — fall back to the DB value. */
  private async readPeakViewers(sessionId: string): Promise<number> {
    let raw: string | null;
    try {
      raw = await this.redis.get(liveKeys.peak(sessionId));
    } catch (error) {
      this.logger.warn({ err: error, sessionId }, 'reading live peak viewers failed');
      return 0;
    }
    const peak = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isSafeInteger(peak) && peak > 0 ? peak : 0;
  }

  /** Chat/viewers/peak/muted are kept 24 h after the end (plan §1.5). Best-effort. */
  private async expireRealtimeKeys(sessionId: string): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      for (const key of liveKeysExpiringOnEnd(sessionId)) {
        pipeline.expire(key, LIVE_ENDED_KEY_TTL_SECONDS);
      }
      await pipeline.exec();
    } catch (error) {
      this.logger.warn({ err: error, sessionId }, 'expiring live realtime keys failed');
    }
  }
}
