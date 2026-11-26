import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type LivePlayback,
  type LiveSession,
  type LiveSessionProduct,
  LiveSessionProductSchema,
  LiveSessionSchema,
  LiveSessionStatus,
  type VendorLiveSession,
  VendorLiveSessionSchema,
} from '@repo/core';
import type { Prisma } from '@repo/db';
import type { StreamProvider } from '@repo/streaming';
import { STREAM_PROVIDER } from './stream-provider.provider';

/** Every read of a session for a DTO uses this include (line-up in `position` order). */
export const LIVE_SESSION_INCLUDE = {
  products: { orderBy: { position: 'asc' } },
} satisfies Prisma.LiveSessionInclude;

export type LiveSessionRow = Prisma.LiveSessionGetPayload<{
  include: typeof LIVE_SESSION_INCLUDE;
}>;

type LiveSessionProductRow = LiveSessionRow['products'][number];

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

/** DB row → core DTO. Every DTO is parsed through its core schema before it leaves the server. */
@Injectable()
export class LiveSessionMapper {
  private readonly logger = new Logger(LiveSessionMapper.name);

  constructor(@Inject(STREAM_PROVIDER) private readonly stream: StreamProvider) {}

  toPublic(row: LiveSessionRow): LiveSession {
    return LiveSessionSchema.parse(this.publicShape(row));
  }

  /** Owner / platform view: public fields + provisioning, encoder, end note, createdAt. */
  toVendor(row: LiveSessionRow): VendorLiveSession {
    return VendorLiveSessionSchema.parse({
      ...this.publicShape(row),
      isProvisioned: row.liveInputId !== null,
      isEncoderConnected: row.encoderConnectedAt !== null,
      endNote: row.endNote,
      createdAt: row.createdAt.toISOString(),
    });
  }

  toProducts(rows: readonly LiveSessionProductRow[]): LiveSessionProduct[] {
    return rows.map((product) =>
      LiveSessionProductSchema.parse({
        productId: product.productId,
        position: product.position,
        pinnedAt: iso(product.pinnedAt),
      }),
    );
  }

  private publicShape(row: LiveSessionRow) {
    return {
      id: row.id,
      vendorId: row.vendorId,
      title: row.title,
      status: row.status,
      scheduledAt: iso(row.scheduledAt),
      startedAt: iso(row.startedAt),
      endedAt: iso(row.endedAt),
      endReason: row.endReason,
      peakViewers: row.peakViewers,
      playback: this.playback(row),
      products: this.toProducts(row.products),
    };
  }

  /** Live input URLs while LIVE, the recording once ENDED with one, otherwise none. */
  private playback(row: LiveSessionRow): LivePlayback | null {
    try {
      if (row.status === LiveSessionStatus.LIVE && row.liveInputId !== null) {
        return this.stream.livePlayback(row.liveInputId);
      }
      if (row.status === LiveSessionStatus.ENDED && row.recordingVideoId !== null) {
        return this.stream.videoPlayback(row.recordingVideoId);
      }
    } catch (error) {
      // Pure URL builders only throw on an id the provider would never issue — a bad row
      // should hide the player, not fail the whole listing.
      this.logger.warn({ err: error, sessionId: row.id }, 'live playback unavailable');
    }
    return null;
  }
}
