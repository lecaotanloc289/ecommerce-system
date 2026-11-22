import { z } from 'zod';
import { LiveEndReasonSchema, LiveSessionStatusSchema } from '../enums';
import {
  LiveSessionIdSchema,
  ProductIdSchema,
  UlidSchema,
  UserIdSchema,
  VendorIdSchema,
} from '../ids';
import { HttpUrlSchema } from './common';

// Payload sanity bounds. Not business tunables.
const MAX_LIVE_PRODUCTS = 50;
const isUnique = (values: readonly string[]): boolean => new Set(values).size === values.length;

/** Core-only (never persisted, not a Prisma enum) — hence not in `enums/`. */
export const ReactionKindSchema = z.enum(['HEART', 'LIKE', 'WOW', 'CLAP']);
export type ReactionKind = z.infer<typeof ReactionKindSchema>;
export const ReactionKind = ReactionKindSchema.enum;

/** Chat message id = Redis Stream entry id (`<ms>-<seq>`). */
export const LiveChatMessageIdSchema = z
  .string()
  .regex(/^\d+-\d+$/, { message: 'Invalid chat message id' });
export type LiveChatMessageId = z.infer<typeof LiveChatMessageIdSchema>;

const IsoDateTimeSchema = z.iso.datetime();
/** Request input: also accept an explicit offset (`+07:00`) from browsers; reads stay UTC `Z`. */
const IsoDateTimeInputSchema = z.iso.datetime({ offset: true });

// ---------------------------------------------------------------- requests

export const LiveSessionTitleSchema = z.string().trim().min(3).max(120);
export type LiveSessionTitle = z.infer<typeof LiveSessionTitleSchema>;

const LiveProductIdsSchema = z
  .array(ProductIdSchema)
  .max(MAX_LIVE_PRODUCTS)
  .refine(isUnique, 'Duplicate productId');

export const CreateLiveSessionSchema = z.object({
  title: LiveSessionTitleSchema,
  scheduledAt: IsoDateTimeInputSchema.nullable().default(null),
  productIds: LiveProductIdsSchema,
});
export type CreateLiveSession = z.infer<typeof CreateLiveSessionSchema>;

/** Array order = `position`. */
export const ReplaceLiveSessionProductsSchema = z.object({ productIds: LiveProductIdsSchema });
export type ReplaceLiveSessionProducts = z.infer<typeof ReplaceLiveSessionProductsSchema>;

export const TerminateLiveSessionSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type TerminateLiveSession = z.infer<typeof TerminateLiveSessionSchema>;

export const SendLiveChatMessageSchema = z.object({
  clientMessageId: UlidSchema,
  text: z.string().trim().min(1).max(200),
});
export type SendLiveChatMessage = z.infer<typeof SendLiveChatMessageSchema>;

export const SendLiveReactionSchema = z.object({ kind: ReactionKindSchema });
export type SendLiveReaction = z.infer<typeof SendLiveReactionSchema>;

export const MuteLiveUserSchema = z.object({ userId: UserIdSchema });
export type MuteLiveUser = z.infer<typeof MuteLiveUserSchema>;

export const ListLiveSessionsQuerySchema = z.object({ status: LiveSessionStatusSchema.optional() });
export type ListLiveSessionsQuery = z.infer<typeof ListLiveSessionsQuerySchema>;

/** Dev-only: simulate the encoder connecting / disconnecting with the fake provider. */
export const SimulateEncoderSchema = z.object({ connected: z.boolean() });
export type SimulateEncoder = z.infer<typeof SimulateEncoderSchema>;

// ---------------------------------------------------------------- reads

export const LivePlaybackSchema = z.object({ hlsUrl: HttpUrlSchema, iframeUrl: HttpUrlSchema });
export type LivePlayback = z.infer<typeof LivePlaybackSchema>;

export const LiveSessionProductSchema = z.object({
  productId: ProductIdSchema,
  position: z.number().int().nonnegative(),
  pinnedAt: IsoDateTimeSchema.nullable(),
});
export type LiveSessionProduct = z.infer<typeof LiveSessionProductSchema>;

export const LiveSessionSchema = z.object({
  id: LiveSessionIdSchema,
  vendorId: VendorIdSchema,
  title: z.string(),
  status: LiveSessionStatusSchema,
  scheduledAt: IsoDateTimeSchema.nullable(),
  startedAt: IsoDateTimeSchema.nullable(),
  endedAt: IsoDateTimeSchema.nullable(),
  endReason: LiveEndReasonSchema.nullable(),
  peakViewers: z.number().int().nonnegative(),
  playback: LivePlaybackSchema.nullable(),
  products: z.array(LiveSessionProductSchema),
});
export type LiveSession = z.infer<typeof LiveSessionSchema>;

export const VendorLiveSessionSchema = LiveSessionSchema.extend({
  isProvisioned: z.boolean(),
  isEncoderConnected: z.boolean(),
  endNote: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type VendorLiveSession = z.infer<typeof VendorLiveSessionSchema>;

export const LiveIngestCredentialsSchema = z.object({
  rtmpsUrl: z.string().startsWith('rtmps://'),
  streamKey: z.string().min(1),
});
export type LiveIngestCredentials = z.infer<typeof LiveIngestCredentialsSchema>;

export const LiveChatMessageSchema = z.object({
  id: LiveChatMessageIdSchema,
  sessionId: LiveSessionIdSchema,
  userId: UserIdSchema,
  displayName: z.string(),
  text: z.string(),
  sentAt: IsoDateTimeSchema,
});
export type LiveChatMessage = z.infer<typeof LiveChatMessageSchema>;

// ---------------------------------------------------------------- realtime events

const ReactionCountsSchema = z.partialRecord(ReactionKindSchema, z.number().int().min(1));

export const LiveEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.provisioned'), sessionId: LiveSessionIdSchema }),
  z.object({
    type: z.literal('session.live'),
    sessionId: LiveSessionIdSchema,
    startedAt: IsoDateTimeSchema,
  }),
  z.object({
    type: z.literal('session.ended'),
    sessionId: LiveSessionIdSchema,
    endedAt: IsoDateTimeSchema,
    endReason: LiveEndReasonSchema,
  }),
  z.object({ type: z.literal('session.cancelled'), sessionId: LiveSessionIdSchema }),
  z.object({
    type: z.literal('encoder.status'),
    sessionId: LiveSessionIdSchema,
    isConnected: z.boolean(),
  }),
  z.object({
    type: z.literal('products.updated'),
    sessionId: LiveSessionIdSchema,
    products: z.array(LiveSessionProductSchema),
  }),
  z.object({
    type: z.literal('product.pinned'),
    sessionId: LiveSessionIdSchema,
    productId: ProductIdSchema,
    pinnedAt: IsoDateTimeSchema,
  }),
  z.object({
    type: z.literal('product.unpinned'),
    sessionId: LiveSessionIdSchema,
    productId: ProductIdSchema,
  }),
  z.object({ type: z.literal('chat.message'), message: LiveChatMessageSchema }),
  z.object({
    type: z.literal('chat.deleted'),
    sessionId: LiveSessionIdSchema,
    messageId: LiveChatMessageIdSchema,
  }),
  z.object({
    type: z.literal('reaction.burst'),
    sessionId: LiveSessionIdSchema,
    counts: ReactionCountsSchema,
  }),
  z.object({
    type: z.literal('viewers.updated'),
    sessionId: LiveSessionIdSchema,
    count: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('recording.ready'), sessionId: LiveSessionIdSchema }),
]);
export type LiveEvent = z.infer<typeof LiveEventSchema>;

// ---------------------------------------------------------------- outbox payloads

export const LIVE_OUTBOX_AGGREGATE_TYPE = 'LiveSession';

export const LIVE_OUTBOX_EVENT_TYPES = [
  'live_session.provision_requested',
  'live_session.started',
  'live_session.encoder_disconnected',
  'live_session.ended',
  'live_session.cancelled',
] as const;
export const LiveOutboxEventTypeSchema = z.enum(LIVE_OUTBOX_EVENT_TYPES);
export type LiveOutboxEventType = z.infer<typeof LiveOutboxEventTypeSchema>;

const LiveInputIdSchema = z.string().min(1);

export const LiveOutboxEventSchema = z.discriminatedUnion('eventType', [
  z.object({
    eventType: z.literal('live_session.provision_requested'),
    payload: z.object({ liveSessionId: LiveSessionIdSchema }),
  }),
  z.object({
    eventType: z.literal('live_session.started'),
    payload: z.object({
      liveSessionId: LiveSessionIdSchema,
      vendorId: VendorIdSchema,
      startedAt: IsoDateTimeSchema,
    }),
  }),
  z.object({
    eventType: z.literal('live_session.encoder_disconnected'),
    payload: z.object({ liveSessionId: LiveSessionIdSchema, disconnectedAt: IsoDateTimeSchema }),
  }),
  z.object({
    eventType: z.literal('live_session.ended'),
    payload: z.object({
      liveSessionId: LiveSessionIdSchema,
      vendorId: VendorIdSchema,
      liveInputId: LiveInputIdSchema.nullable(),
      endReason: LiveEndReasonSchema,
    }),
  }),
  z.object({
    eventType: z.literal('live_session.cancelled'),
    payload: z.object({
      liveSessionId: LiveSessionIdSchema,
      liveInputId: LiveInputIdSchema.nullable(),
    }),
  }),
]);
export type LiveOutboxEvent = z.infer<typeof LiveOutboxEventSchema>;
