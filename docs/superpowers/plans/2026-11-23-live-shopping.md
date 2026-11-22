# Live Shopping Implementation Plan

**Goal:** Ship the live-shopping MVP backend (domain, DB, Cloudflare Stream adapter, API, outbox
worker, realtime chat) and the storefront viewer pages, per
`docs/superpowers/specs/2026-11-23-live-shopping-design.md`.

**Spec decisions locked for this plan (2026-11-23):** D1 = build `workers/outbox`; D2 = fetch the
stream key from Cloudflare on demand; D3 = SSE down + HTTP POST up; D4 = `VENDOR_OWNER` +
`VENDOR_STAFF` can broadcast; D5 = chat in Redis only (24 h after end).

**Changes vs the spec (this plan wins where they differ):**

- The provider adapter lives in a new package **`@repo/streaming`** (`packages/streaming`), not
  inside `server/`, because the outbox worker must call it too and workers may not import `server`.
- New top-level workspace **`@workers/outbox`** (`workers/outbox`), added to `pnpm-workspace.yaml`.
- `LiveSession` gains `idempotencyKey`, `encoderDisconnectedAt`, `encoderStatusAt`, `endNote`;
  `endReason` becomes an enum. Full schema in §2.2.
- Storefront is a static export (`output: 'export'`), so `/live/[id]` pre-renders mock ids via
  `generateStaticParams` (same pattern as `product/[slug]`).
- **Deferred (not in this plan):** vendor broadcast console in `apps/admin` (admin is a bare
  scaffold), Playwright E2E (not set up in any app yet), Phase 0 live spike against a real
  Cloudflare account (needs the owner's account; the adapter is built from Cloudflare docs and
  verified with recorded fixtures + the fake provider).

**Run order and owners**

| Task | Scope                                   | Workspace(s)           | Model                  | Depends on |
| ---- | --------------------------------------- | ---------------------- | ---------------------- | ---------- |
| 0    | Branch, scaffold, deps                  | root                   | lead                   | —          |
| A    | Domain contracts                        | `packages/core`        | Sonnet                 | 0          |
| B    | Cloudflare Stream adapter + webhooks    | `packages/streaming`   | Opus                   | 0          |
| C    | Prisma models, migrations, seed         | `packages/db`          | Sonnet                 | 0          |
| D    | vi/en messages                          | `packages/i18n`        | Haiku                  | A          |
| E    | Live sessions API + webhooks + PG tests | `server`               | Opus                   | A, B, C    |
| F    | Outbox dispatcher + live handlers       | `workers/outbox`       | Opus                   | A, B, C    |
| G    | Realtime: SSE, chat, reactions, viewers | `server`               | Opus                   | E          |
| H    | Storefront live pages (mock data)       | `apps/client`          | Sonnet                 | D          |
| I    | Docs sync                               | `*.md`, `.env.example` | Haiku                  | all        |
| R    | Review → fix → commit                   | all                    | lead + `code-reviewer` | all        |

Waves: **1** = A ‖ B ‖ C → **2** = D ‖ E ‖ F, then H after D → **3** = G → **4** = I, R.

**Rules for every task agent**

- Read root `CLAUDE.md` and your workspace's `CLAUDE.md` first. Golden Rules + NEVER DO apply
  (no `any`, no `as unknown as`, no `@ts-ignore`, no `eslint-disable`, no `console.log`).
- **Touch only your workspace.** If you need a change elsewhere (e.g. a new core schema), stop and
  report it. Do not run `pnpm install` / `pnpm add` (deps are pre-installed in Task 0; if one is
  missing, report it).
- Do **not** commit. The lead reviews and commits per task.
- Finish with: files changed, commands run with their real output (pass/fail counts), anything
  left undone, any deviation from this plan and why.

---

## 1. Shared contracts (all tasks code against these)

### 1.1 Enums (core mirror ⇄ Prisma, values exactly)

```
LiveSessionStatus = SCHEDULED | LIVE | ENDED | CANCELLED
LiveEndReason     = VENDOR | DISCONNECT_TIMEOUT | TERMINATED
```

`ReactionKind = HEART | LIKE | WOW | CLAP` is **core-only** (never persisted, not a Prisma enum).

### 1.2 Error codes (`ERROR_CODES` + `ERROR_HTTP_STATUS`)

| Code                                     | HTTP |
| ---------------------------------------- | ---- |
| `live.error.not-found`                   | 404  |
| `live.error.invalid-transition`          | 409  |
| `live.error.not-provisioned`             | 409  |
| `live.error.encoder-offline`             | 409  |
| `live.error.already-live`                | 409  |
| `live.error.not-live`                    | 409  |
| `live.error.product-not-owned`           | 422  |
| `live.error.product-inactive`            | 422  |
| `live.error.too-many-products`           | 422  |
| `live.error.chat-rate-limited`           | 429  |
| `live.error.chat-muted`                  | 403  |
| `live.error.webhook-signature-invalid`   | 401  |
| `live.error.stream-provider-unavailable` | 503  |

### 1.3 IDs

`LiveSessionIdSchema = UlidSchema.brand<'LiveSessionId'>()` in `@repo/core/ids`.
Chat message ids are Redis Stream entry ids (`<ms>-<seq>`), schema `LiveChatMessageIdSchema =
z.string().regex(/^\d+-\d+$/)`.

### 1.4 Core schemas — `packages/core/src/schemas/live.ts` (export from `schemas/index.ts`)

Requests (never carry `vendorId`, `userId`, `role`, `price`):

| Schema                             | Shape                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| `LiveSessionTitleSchema`           | string, trimmed, 3–120 chars                                                                        |
| `CreateLiveSessionSchema`          | `{ title, scheduledAt: iso datetime \| null (default null), productIds: ProductId[] 0–50, unique }` |
| `ReplaceLiveSessionProductsSchema` | `{ productIds: ProductId[] 0–50, unique }` (array order = `position`)                               |
| `TerminateLiveSessionSchema`       | `{ reason: string trimmed 3–500 }`                                                                  |
| `SendLiveChatMessageSchema`        | `{ clientMessageId: Ulid, text: string trimmed 1–200 }`                                             |
| `SendLiveReactionSchema`           | `{ kind: ReactionKind }`                                                                            |
| `MuteLiveUserSchema`               | `{ userId: UserId }`                                                                                |
| `ListLiveSessionsQuerySchema`      | `{ status?: LiveSessionStatus }`                                                                    |
| `SimulateEncoderSchema` (dev)      | `{ connected: boolean }`                                                                            |

Reads (mirror DB nullability with `null`, dates as ISO strings):

```
LivePlaybackSchema        { hlsUrl: HttpUrl, iframeUrl: HttpUrl }
LiveSessionProductSchema  { productId, position: int>=0, pinnedAt: iso | null }
LiveSessionSchema (public){ id, vendorId, title, status, scheduledAt|null, startedAt|null,
                            endedAt|null, endReason|null, peakViewers: int>=0,
                            playback: LivePlayback|null, products: LiveSessionProduct[] }
VendorLiveSessionSchema   = LiveSessionSchema.extend({ isProvisioned: boolean,
                            isEncoderConnected: boolean, endNote|null, createdAt: iso })
LiveIngestCredentialsSchema { rtmpsUrl: string (rtmps://…), streamKey: string min 1 }
LiveChatMessageSchema     { id: LiveChatMessageId, sessionId, userId, displayName, text, sentAt: iso }
```

Realtime event union `LiveEventSchema` = `z.discriminatedUnion('type', [...])`:

```
{ type: 'session.provisioned', sessionId }
{ type: 'session.live',        sessionId, startedAt }
{ type: 'session.ended',       sessionId, endedAt, endReason }
{ type: 'session.cancelled',   sessionId }
{ type: 'encoder.status',      sessionId, isConnected: boolean }
{ type: 'products.updated',    sessionId, products: LiveSessionProduct[] }
{ type: 'product.pinned',      sessionId, productId, pinnedAt }
{ type: 'product.unpinned',    sessionId, productId }
{ type: 'chat.message',        message: LiveChatMessage }
{ type: 'chat.deleted',        sessionId, messageId }
{ type: 'reaction.burst',      sessionId, counts: Partial<Record<ReactionKind, int>=1>> }
{ type: 'viewers.updated',     sessionId, count: int>=0 }
{ type: 'recording.ready',     sessionId }
```

Outbox payloads `LiveOutboxEventSchema` = discriminated union on `eventType`
(`aggregateType = 'LiveSession'`, `aggregateId = liveSessionId`; export
`LIVE_OUTBOX_EVENT_TYPES`):

```
{ eventType: 'live_session.provision_requested', payload: { liveSessionId } }
{ eventType: 'live_session.started',             payload: { liveSessionId, vendorId, startedAt } }
{ eventType: 'live_session.encoder_disconnected',payload: { liveSessionId, disconnectedAt } }
{ eventType: 'live_session.ended',               payload: { liveSessionId, vendorId, liveInputId|null, endReason } }
{ eventType: 'live_session.cancelled',           payload: { liveSessionId, liveInputId|null } }
```

### 1.5 Redis keys and channels (server ⇄ worker)

| Key / channel                             | Type        | Writer         | Meaning                                    |
| ----------------------------------------- | ----------- | -------------- | ------------------------------------------ |
| `live:{id}:events`                        | pub/sub     | server, worker | JSON `LiveEvent` (validate before publish) |
| `live:{id}:chat`                          | Stream      | server         | chat, `XADD MAXLEN ~ 200`                  |
| `live:{id}:viewers`                       | ZSET        | server         | member = SSE connection id, score = ms     |
| `live:{id}:peak`                          | string int  | server         | max viewers seen (Lua max)                 |
| `live:{id}:muted`                         | SET         | server         | muted userIds                              |
| `live:{id}:chat-dedupe:{clientMessageId}` | string, 10m | server         | dedupe chat POST → stored message id       |
| `live:{id}:cooldown:{userId}`             | string, PX  | server         | chat cooldown (`SET NX PX`)                |
| `live:webhook-dedupe:{sha256}`            | string, 24h | server         | webhook replay guard                       |

After a session ends: `EXPIRE 86400` on `chat`, `viewers`, `peak`, `muted`.

### 1.6 `@repo/streaming` API (Task B builds, E/F consume)

```ts
interface StreamProvider {
  createLiveInput(input: { liveSessionId: string }): Promise<{ liveInputId: string }>;
  getIngestCredentials(liveInputId: string): Promise<{ rtmpsUrl: string; streamKey: string }>;
  /** Stop accepting broadcasts on this input; recordings must survive. Idempotent (404 = done). */
  retireLiveInput(liveInputId: string): Promise<void>;
  /** Pure — no network. */
  livePlayback(liveInputId: string): { hlsUrl: string; iframeUrl: string };
  videoPlayback(videoId: string): { hlsUrl: string; iframeUrl: string };
}
class CloudflareStreamProvider implements StreamProvider   // ctor { accountId, apiToken, customerCode, fetch? }
class FakeStreamProvider implements StreamProvider         // in-memory, deterministic
class StreamProviderError extends Error { status?: number; retryable: boolean }
createStreamProvider(config): StreamProvider               // 'fake' | 'cloudflare'

verifyNotificationWebhook(headers, secret): boolean        // cf-webhook-auth, timing-safe
verifyStreamWebhookSignature({ signatureHeader, rawBody, secret, nowSeconds, toleranceSeconds = 300 }): boolean
parseLiveInputNotification(json): { liveInputId, event: 'connected' | 'disconnected' | 'errored', occurredAt: Date } | null
parseStreamVideoWebhook(json):    { videoId, liveInputId: string | null, readyToStream: boolean } | null
```

### 1.7 Env (server: `src/config/env.ts`; worker: own Zod env)

| Var                                       | Server | Worker | Notes                                        |
| ----------------------------------------- | ------ | ------ | -------------------------------------------- |
| `LIVE_STREAM_PROVIDER`                    | ✓      | ✓      | `fake` (default) \| `cloudflare`             |
| `CLOUDFLARE_STREAM_ACCOUNT_ID`            | ✓      | ✓      | required when `cloudflare`                   |
| `CLOUDFLARE_STREAM_API_TOKEN`             | ✓      | ✓      | required when `cloudflare` (Stream: Edit)    |
| `CLOUDFLARE_STREAM_CUSTOMER_CODE`         | ✓      | ✓      | required when `cloudflare`; fake uses `fake` |
| `CLOUDFLARE_STREAM_WEBHOOK_SECRET`        | ✓      |        | required when `cloudflare`                   |
| `CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET` | ✓      |        | required when `cloudflare`                   |
| `DATABASE_URL`, `REDIS_URL`               | ✓      | ✓      | existing                                     |

### 1.8 State machine (Task E implements, Task F's grace job uses the same guard)

Every transition = one `$transaction`: guarded `updateMany({ where: { id, status: expected, … } })`
→ `count === 0` ⇒ re-read: already in target state ⇒ return it (idempotent); else
`live.error.invalid-transition`. Same transaction inserts the outbox row. Redis publish happens
**after** commit.

| From      | To        | Trigger                                               | Extra guard                                                                                                           | Outbox                   |
| --------- | --------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| SCHEDULED | LIVE      | vendor go-live                                        | `liveInputId != null`, `encoderConnectedAt != null`; partial unique (one LIVE per vendor) → `live.error.already-live` | `live_session.started`   |
| SCHEDULED | CANCELLED | vendor cancel                                         | —                                                                                                                     | `live_session.cancelled` |
| LIVE      | ENDED     | vendor end (`VENDOR`)                                 | —                                                                                                                     | `live_session.ended`     |
| LIVE      | ENDED     | platform terminate (`TERMINATED`, `endNote = reason`) | —                                                                                                                     | `live_session.ended`     |
| LIVE      | ENDED     | grace job (`DISCONNECT_TIMEOUT`)                      | `encoderConnectedAt IS NULL AND encoderDisconnectedAt <= now − grace`                                                 | `live_session.ended`     |

Encoder webhooks (any non-terminal status) update `encoderConnectedAt` / `encoderDisconnectedAt`
only if `occurredAt > encoderStatusAt` (out-of-order safe), then set `encoderStatusAt =
occurredAt`. A disconnect while `LIVE` also inserts `live_session.encoder_disconnected`.
On `ENDED`, `peakViewers = max(db, Redis live:{id}:peak)`.

---

## 2. Tasks

### Task 0 — Scaffold (lead, done)

- Branch `feat/live-shopping`; `pnpm-workspace.yaml` += `workers/*`.
- `packages/streaming` and `workers/outbox` skeletons (package.json, tsconfig, tsup, vitest).
- Deps: worker `bullmq ioredis pino zod tsx`; server `@repo/streaming`, dev `@testcontainers/postgresql`.
- Verify: `pnpm install` OK; `pnpm turbo run build --filter=@repo/{core,db,streaming,i18n}` green.

### Task A — Domain contracts (`packages/core`, Sonnet)

**Goal:** every shape in §1.1–1.4 exists once in core, typed via `z.infer`, tested.

Work:

1. `src/enums/index.ts`: `LiveSessionStatus`, `LiveEndReason` (same 3-export pattern), plus
   `ReactionKindSchema` (core-only — put it in `schemas/live.ts`, NOT `enums/`, because
   `test/enums.test.ts` requires every enum in `enums/` to exist in Prisma; check that test's
   logic and place it accordingly).
2. `src/ids/index.ts`: `LiveSessionIdSchema` / `LiveSessionId`.
3. `src/errors/index.ts`: the 13 codes + statuses from §1.2, in a `// live` group.
4. `src/schemas/live.ts`: all schemas in §1.4; export from `schemas/index.ts`.
5. Tests `test/live.test.ts`: ≥1 valid + ≥1 invalid per schema; title trimming/length bounds;
   duplicate `productIds` rejected; 51 products rejected; chat text 0 and 201 chars rejected,
   whitespace-only rejected; each `LiveEvent` variant parses, unknown `type` fails; each outbox
   variant parses, payload/eventType mismatch fails.

**Verify:** `pnpm --filter @repo/core typecheck && pnpm --filter @repo/core test && pnpm --filter @repo/core build`.
Note: `test/enums.test.ts` will fail until Task C adds the Prisma enums — expected in wave 1; the lead re-runs it after C.

### Task B — `@repo/streaming` (`packages/streaming`, Opus)

**Goal:** a provider-agnostic, fully unit-tested adapter for Cloudflare Stream live inputs and
both webhook types, plus a fake for dev/tests. No DB, no Nest, no `@repo/core` dependency.

Work:

1. **Verify Cloudflare docs first** (developers.cloudflare.com/stream): live input create/get/
   update/delete endpoints and response fields (`uid`, `rtmps.url`, `rtmps.streamKey`,
   `recording.mode`), whether a live input can be disabled vs must be deleted and whether deleting
   keeps its recordings (choose `retireLiveInput` accordingly), playback URL formats
   (`customer-<code>.cloudflarestream.com/<uid>/manifest/video.m3u8` and `/iframe`), the Stream
   webhook signature (`Webhook-Signature: time=…,sig1=…`, HMAC-SHA256 over `time + "." + body`),
   the video webhook payload (`uid`, `readyToStream`, `liveInput`), and the Notifications
   "Stream Live Input" webhook payload + `cf-webhook-auth` header. Record sources + findings in
   `packages/streaming/CLAUDE.md` (create it; follow the style of `packages/core/CLAUDE.md`).
2. `src/provider.ts` (interface §1.6, `StreamProviderError`), `src/cloudflare.ts` (fetch-based,
   Bearer token, parse every response with Zod, map 5xx/network → `retryable: true`, 4xx →
   `false`, 404 on retire → success), `src/fake.ts`, `src/webhooks.ts`, `src/index.ts`,
   `createStreamProvider`.
   - `createLiveInput` sends `recording: { mode: 'automatic' }` and `meta: { name: liveSessionId }`.
   - Signature check: constant-time (`crypto.timingSafeEqual` on equal-length buffers), reject
     timestamps outside tolerance, reject malformed headers without throwing.
3. Tests (`test/*.test.ts`, mocked `fetch`): request URL/method/headers/body per method; Zod
   failure on malformed response; error mapping; retire 404 = ok; playback URLs; signature valid /
   wrong secret / tampered body / stale timestamp / malformed header; notification auth;
   payload parsers on doc-shaped fixtures (store fixtures in `test/fixtures/*.json`) + junk input → `null`.

**Verify:** `pnpm --filter @repo/streaming typecheck && pnpm --filter @repo/streaming test && pnpm --filter @repo/streaming build`.

### Task C — Database (`packages/db`, Sonnet)

**Goal:** additive, forward-only migrations for live sessions; seed demo data; DB-level invariants tested.

Schema (add to `schema.prisma`, plus back-relations on `Vendor.liveSessions`,
`User.createdLiveSessions`, `Product.liveSessionProducts`):

```prisma
enum LiveSessionStatus { SCHEDULED LIVE ENDED CANCELLED }
enum LiveEndReason { VENDOR DISCONNECT_TIMEOUT TERMINATED }

model LiveSession {
  id                    String             @id
  vendorId              String             @map("vendor_id")
  createdById           String             @map("created_by_id")
  idempotencyKey        String             @map("idempotency_key")
  title                 String
  status                LiveSessionStatus  @default(SCHEDULED)
  scheduledAt           DateTime?          @map("scheduled_at")
  liveInputId           String?            @unique @map("live_input_id")
  encoderConnectedAt    DateTime?          @map("encoder_connected_at")
  encoderDisconnectedAt DateTime?          @map("encoder_disconnected_at")
  encoderStatusAt       DateTime?          @map("encoder_status_at")
  startedAt             DateTime?          @map("started_at")
  endedAt               DateTime?          @map("ended_at")
  endReason             LiveEndReason?     @map("end_reason")
  endNote               String?            @map("end_note")
  recordingVideoId      String?            @map("recording_video_id")
  peakViewers           Int                @default(0) @map("peak_viewers")
  createdAt             DateTime           @default(now()) @map("created_at")
  updatedAt             DateTime           @updatedAt @map("updated_at")

  vendor    Vendor               @relation(fields: [vendorId], references: [id], onDelete: Restrict)
  createdBy User                 @relation("LiveSessionCreator", fields: [createdById], references: [id])
  products  LiveSessionProduct[]

  @@unique([vendorId, idempotencyKey])
  @@index([vendorId, status])
  @@index([status, startedAt])
  @@map("live_sessions")
}

model LiveSessionProduct {
  liveSessionId String    @map("live_session_id")
  productId     String    @map("product_id")
  position      Int
  pinnedAt      DateTime? @map("pinned_at")

  liveSession LiveSession @relation(fields: [liveSessionId], references: [id], onDelete: Cascade)
  product     Product     @relation(fields: [productId], references: [id], onDelete: Restrict)

  @@id([liveSessionId, productId])
  @@index([productId])
  @@map("live_session_products")
}
```

`PlatformSettings` += `liveDisconnectGraceSeconds Int @default(120) @map("live_disconnect_grace_seconds")`
and `liveChatCooldownSeconds Int @default(2) @map("live_chat_cooldown_seconds")`.

Work:

1. Migration 1 `add_live_sessions`: `pnpm --filter @repo/db exec prisma migrate dev --create-only --name add_live_sessions`.
   **Read the generated SQL and delete every statement that drops/alters `search_vector`,
   `product_translations_search_vector_idx`, `product_translations_name_trgm_idx`,
   `category_translations_name_trgm_idx`, or `coupons_platform_code_key`** (see
   `packages/db/CLAUDE.md` "Search-index drift"; the `widen_money_columns_to_bigint` migration is
   the precedent). Never accept a prompt to reset the database.
2. Migration 2 `add_live_session_partial_indexes` (hand-written SQL, new folder with a later timestamp):
   - `CREATE UNIQUE INDEX live_sessions_one_live_per_vendor_key ON live_sessions (vendor_id) WHERE status = 'LIVE';`
   - `CREATE UNIQUE INDEX live_session_products_one_pinned_key ON live_session_products (live_session_id) WHERE pinned_at IS NOT NULL;`
3. Apply with `pnpm --filter @repo/db migrate:deploy` (avoids `migrate dev` re-proposing drift
   drops), then `pnpm db:generate`.
4. Seed (`src/seed.ts`, idempotent upserts, new fixed ids in `src/seed-ids.ts` using the existing
   `01SEED…` pattern): for the first seeded ACTIVE vendor, one `ENDED` session (`endReason
VENDOR`, `recordingVideoId 'seed-recording-1'`, 3 of its ACTIVE products, peakViewers 128) and
   one `SCHEDULED` session (no `liveInputId`, 2 products). PlatformSettings seed values 120 / 2.
5. Tests `test/live-session.constraints.test.ts` (local Postgres, same setup as existing tests):
   second `LIVE` session for the same vendor fails (unique violation); a `LIVE` + an `ENDED` for
   the same vendor is fine; two pinned products in one session fail; `(vendorId, idempotencyKey)`
   unique. Clean up rows the test creates.

**Verify:** both migration folders exist and contain no drift drops; `pnpm --filter @repo/db typecheck`;
`pnpm db:seed` run twice without error; `pnpm --filter @repo/db test`; `pnpm --filter @repo/db build`;
`pnpm --filter @repo/core test` (enum mirror) passes once Task A is in.

### Task D — i18n (`packages/i18n`, Haiku)

**Goal:** every new error code and every storefront live string exists in en + vi.

Work:

1. `src/messages/errors.ts`: add all 13 `live.error.*` codes to `errorsEn` and `errorsVi`
   (short, user-facing, no `{params}`).
2. `src/messages/en.ts` + `vi.ts`: new top-level namespace `live` (camelCase leaves) with exactly
   these keys: `nav, listTitle, sectionLive, sectionUpcoming, sectionReplays, empty, badgeLive,
viewers ({count}), startsAt ({time}), streamedOn ({date}), watchReplay, pinnedProduct,
productsInLive ({count}), chatTitle, chatPlaceholder, chatSend, chatSignInPrompt, chatEmpty,
react, sessionEnded, notStarted, replayProcessing, byVendor ({vendor}), viewProduct,
playerUnavailable`. Placeholders identical in vi and en.

**Verify:** `pnpm --filter @repo/i18n typecheck && pnpm --filter @repo/i18n test && pnpm --filter @repo/i18n build`.

### Task E — Live sessions API (`server`, Opus)

**Goal:** vendor/public/platform/webhook endpoints from spec §8 (minus realtime, which is Task G),
state machine §1.8, Postgres-backed integration tests.

Layout `server/src/live/`: `live.module.ts`, `live-session.service.ts` (state machine + queries),
`live-session.mapper.ts` (row → core DTO, parse with core schemas), `stream-provider.provider.ts`
(Nest provider token `STREAM_PROVIDER` via `createStreamProvider(env)`), `live-events.publisher.ts`
(validates `LiveEvent` then `PUBLISH live:{id}:events`), controllers:
`vendor-live-sessions.controller.ts`, `public-live-sessions.controller.ts`,
`platform-live-sessions.controller.ts`, `live-webhooks.controller.ts`,
`dev-live-sessions.controller.ts` (registered only when `LIVE_STREAM_PROVIDER=fake` and
`NODE_ENV !== 'production'`).

Endpoints (all `/v1`):

| Method | Path                                                  | Guard                | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ----------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/vendor/live-sessions`                               | VENDOR_OWNER/STAFF   | Header `Idempotency-Key` required (`IdempotencyKeySchema`, else `idempotency.error.key-required`). Same key + same vendor ⇒ return existing (200). Re-check vendor ACTIVE in DB (`vendor.error.not-active`). Products must be the caller vendor's (`live.error.product-not-owned`) and ACTIVE (`live.error.product-inactive`). One tx: session + products + outbox `provision_requested`. 201 `VendorLiveSession`. |
| GET    | `/vendor/live-sessions?status=`                       | same                 | Own sessions, newest first, max 100.                                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/vendor/live-sessions/:id`                           | same                 | 404 `live.error.not-found` if not own.                                                                                                                                                                                                                                                                                                                                                                             |
| GET    | `/vendor/live-sessions/:id/ingest-credentials`        | same                 | SCHEDULED/LIVE only; `live.error.not-provisioned` if no input; provider call (documented read-only exception to Rule #9); `Cache-Control: no-store`; provider failure → `live.error.stream-provider-unavailable`.                                                                                                                                                                                                  |
| PUT    | `/vendor/live-sessions/:id/products`                  | same                 | SCHEDULED/LIVE; replace line-up, keep `pinnedAt` for products still present; publish `products.updated`.                                                                                                                                                                                                                                                                                                           |
| POST   | `/vendor/live-sessions/:id/products/:productId/pin`   | same                 | product must be in line-up; tx: unpin others, pin target; publish `product.pinned`.                                                                                                                                                                                                                                                                                                                                |
| POST   | `/vendor/live-sessions/:id/products/:productId/unpin` | same                 | publish `product.unpinned`.                                                                                                                                                                                                                                                                                                                                                                                        |
| POST   | `/vendor/live-sessions/:id/go-live`                   | same                 | §1.8; publish `session.live`.                                                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/vendor/live-sessions/:id/end`                       | same                 | §1.8 (`VENDOR`); publish `session.ended`; set 24 h TTL on Redis keys.                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/vendor/live-sessions/:id/cancel`                    | same                 | §1.8; publish `session.cancelled`.                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/live-sessions?status=`                              | public               | default `LIVE`; allowed `SCHEDULED`, `LIVE`, `ENDED` (ENDED only with a recording); never `CANCELLED`.                                                                                                                                                                                                                                                                                                             |
| GET    | `/live-sessions/:id`                                  | public               | 404 for CANCELLED. `playback` = live input URLs when LIVE, recording URLs when ENDED with `recordingVideoId`, else `null`.                                                                                                                                                                                                                                                                                         |
| GET    | `/platform/live-sessions?status=`                     | PLATFORM_STAFF/ADMIN | all vendors.                                                                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/platform/live-sessions/:id/terminate`               | PLATFORM_STAFF/ADMIN | body `TerminateLiveSessionSchema`; §1.8 `TERMINATED`.                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/webhooks/cloudflare/live-input`                     | none                 | `verifyNotificationWebhook` else 401 `live.error.webhook-signature-invalid`; dedupe by sha256(raw body) in Redis; unknown input → 204; apply §1.8 encoder rules; publish `encoder.status`; 204.                                                                                                                                                                                                                    |
| POST   | `/webhooks/cloudflare/stream`                         | none                 | `verifyStreamWebhookSignature` (needs raw body — enable Fastify raw body for these routes only); `readyToStream && liveInput` → set `recordingVideoId` if null; publish `recording.ready`; 204.                                                                                                                                                                                                                    |
| POST   | `/dev/live-sessions/:id/encoder`                      | VENDOR (dev only)    | body `SimulateEncoderSchema`; calls the same service method as the webhook with `occurredAt = now`.                                                                                                                                                                                                                                                                                                                |

Also: env additions §1.7 with a `refine` requiring Cloudflare vars when provider = `cloudflare`
(+ tests in `test/config/env.spec.ts`); register `LiveModule` in `app.module.ts`.

Test harness (new, reusable): `server/test/integration/pg.ts` — start `@testcontainers/postgresql`
(`postgres:16-alpine`, same as docker-compose), run `prisma migrate deploy` from `packages/db`
against it, set `DATABASE_URL` **before** `@repo/db` is imported, truncate tables between tests;
Redis via the existing `@testcontainers/redis` pattern.

Tests (`server/test/live/`):

- Service integration (PG + Redis): create (happy, idempotent replay, foreign product, inactive
  product, suspended vendor); every §1.8 transition incl. idempotent repeat and invalid ones;
  go-live without encoder / without input; second LIVE for same vendor → `already-live`;
  out-of-order encoder events ignored; disconnect while LIVE writes outbox row; end copies Redis
  peak; outbox rows written in the same tx (assert none on failed transition).
- Ownership: vendor B gets 404 on vendor A's session and cannot pin A's product.
- HTTP (`inject`): role matrix (guest 401, customer 403, vendor OK, staff terminate OK, vendor
  terminate 403); webhook bad auth 401, duplicate delivery processed once, unknown input 204;
  stream webhook valid signature sets recording; `ingest-credentials` with `FakeStreamProvider`.

**Verify:** `pnpm --filter @server/api typecheck && pnpm --filter @server/api test` (all green, report counts).

### Task F — Outbox worker (`workers/outbox`, Opus)

**Goal:** a generic, reusable outbox dispatcher (payments will reuse it) + live-session handlers.

Layout: `src/env.ts` (Zod, §1.7), `src/logger.ts` (pino), `src/dispatcher.ts`,
`src/handlers/registry.ts`, `src/handlers/live-session.ts`, `src/grace.ts`, `src/main.ts`
(wire + graceful shutdown on SIGINT/SIGTERM).

Work:

1. **Dispatcher:** every 1 s, in a tx: `SELECT … FROM outbox_events WHERE processed_at IS NULL
ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED` (`$queryRaw`), add each to BullMQ queue
   `outbox` with `jobId = outbox id` (dedupe), set `processed_at = now()`. Safe with N worker
   replicas.
2. **Queue worker `outbox`:** parse row with core `LiveOutboxEventSchema` (unknown event types →
   log + complete, so other domains can add handlers later); route via registry; retries
   `attempts: 8`, exponential backoff; on each failure update `outbox_events.attempts/last_error`.
3. **Handlers:**
   - `provision_requested` → if session CANCELLED/ENDED: skip. `createLiveInput` → `updateMany
where { id, liveInputId: null }`; if count 0 (retry raced) → `retireLiveInput(new id)`.
     Publish `session.provisioned`.
   - `started` → no-op (log) — placeholder for follower notifications.
   - `encoder_disconnected` → add delayed job to queue `live-disconnect-grace`, delay =
     `PlatformSettings.liveDisconnectGraceSeconds`, `jobId = grace:{sessionId}:{disconnectedAt ms}`.
   - grace job → §1.8 `DISCONNECT_TIMEOUT` guarded transition in one tx (+ outbox `ended`,
     peak from Redis); publish `session.ended`; set 24 h TTL on Redis keys. No-op if reconnected.
   - `ended` / `cancelled` → `retireLiveInput(liveInputId)` when non-null.
   - `StreamProviderError.retryable === false` → fail without retry (`UnrecoverableError`).
4. Tests (vitest, real Postgres via `@testcontainers/postgresql` + Redis via `@testcontainers/redis`,
   same migrate-deploy approach as Task E; `FakeStreamProvider`): dispatcher claims each row once
   with two concurrent dispatchers; unknown type completes; provision happy path + race; grace
   ends a still-disconnected session; reconnect inside grace keeps LIVE; disconnect→reconnect→
   disconnect doesn't end early; retire called on ended/cancelled; non-retryable error not retried.
5. `workers/outbox/CLAUDE.md`: purpose, run (`pnpm --filter @workers/outbox dev`), env, queues,
   how to add a handler.

**Verify:** `pnpm --filter @workers/outbox typecheck && pnpm --filter @workers/outbox test && pnpm --filter @workers/outbox build`.

### Task G — Realtime (`server`, Opus)

**Goal:** SSE event stream, chat, reactions, viewer count, moderation — horizontally scalable via Redis.

Layout `server/src/live/realtime/`: `live-realtime.service.ts` (one dedicated ioredis subscriber
connection — `redis.duplicate()` — shared by all SSE clients of the instance, fan-out per
session via an in-process `Subject`), `live-chat.service.ts`, `live-viewers.service.ts`,
`live-reactions.service.ts`, controllers.

Endpoints:

| Method | Path                                                   | Guard                            | Behaviour                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/live-sessions/:id/events`                            | public                           | SSE (`text/event-stream`); 404 unless SCHEDULED/LIVE; each `LiveEvent` → `event: <type>` + `data: <json>`; `: ping` every 15 s; registers the connection in `viewers` ZSET (refresh score every 15 s, `ZREM` on close).                                                                                                                                                 |
| GET    | `/live-sessions/:id/messages?limit=50`                 | public                           | last N (≤100) from `live:{id}:chat`, oldest first.                                                                                                                                                                                                                                                                                                                      |
| POST   | `/live-sessions/:id/messages`                          | any signed-in role               | `SendLiveChatMessageSchema`; LIVE only (`live.error.not-live`); muted → `live.error.chat-muted`; dedupe via `chat-dedupe` → replay returns original (200); cooldown `PlatformSettings.liveChatCooldownSeconds` via `SET NX PX` → `live.error.chat-rate-limited`; `displayName` from DB `User.name`; `XADD MAXLEN ~ 200`; publish `chat.message`; 201 `LiveChatMessage`. |
| POST   | `/live-sessions/:id/reactions`                         | any signed-in role               | `SendLiveReactionSchema`; LIVE only; ≤10/s per user (Redis); aggregated per instance per session, flushed every 1 s as `reaction.burst`; 202.                                                                                                                                                                                                                           |
| POST   | `/vendor/live-sessions/:id/messages/:messageId/delete` | VENDOR_OWNER/STAFF (own session) | `XDEL`; publish `chat.deleted`; 204.                                                                                                                                                                                                                                                                                                                                    |
| POST   | `/vendor/live-sessions/:id/mutes`                      | same                             | `MuteLiveUserSchema` → `SADD`; 204.                                                                                                                                                                                                                                                                                                                                     |
| POST   | `/vendor/live-sessions/:id/mutes/:userId/unmute`       | same                             | `SREM`; 204.                                                                                                                                                                                                                                                                                                                                                            |

Viewer ticker: per instance, per session with ≥1 local SSE client, every 5 s: `ZREMRANGEBYSCORE`
entries older than 30 s, `ZCARD`, Lua max into `peak`; only the instance that wins
`SET live:{id}:viewers-tick NX PX 4500` publishes `viewers.updated`. Stop timers when the last
local client disconnects and on module destroy.

Tests (`server/test/live/realtime/`, Redis testcontainer + PG harness from Task E):
two `LiveRealtimeService` instances on separate connections both receive one publish; SSE over a
real listening Fastify app (`app.listen(0)` + `fetch` stream reader) receives a pinned event and
a ping; viewer count rises/falls with connections; chat: guest 401, not-live 409, muted 403,
cooldown boundary (2nd within cooldown 429, after cooldown 201), dedupe replay returns same id,
201 > 200 chars rejected 422; vendor B cannot delete A's message; reactions aggregate into one burst.

**Verify:** `pnpm --filter @server/api typecheck && pnpm --filter @server/api test`.

### Task H — Storefront (`apps/client`, Sonnet)

**Goal:** browsable live list + watch page on mock data, built so swapping to `@repo/sdk` +
`EventSource` later touches only the data hooks.

Work:

1. `src/mocks/live.ts`: 1 LIVE, 1 SCHEDULED, 2 ENDED sessions referencing existing mock products
   (shape mirrors core `LiveSession` where the storefront mock types allow; local display type is
   fine, as with products — see `apps/client/CLAUDE.md` "Types"), plus ~20 mock chat lines.
2. `src/lib/live-events.ts`: `useLiveEvents(sessionId)` hook returning `{ messages, viewers,
pinnedProductId, sendMessage, sendReaction }`. Mock implementation: timers emit chat lines and
   viewer changes; `sendMessage` appends locally. Keep the event names/shapes of core
   `LiveEvent` so the real version is a drop-in.
3. Pages: `src/app/live/page.tsx` (sections Live now / Upcoming / Replays, empty state) and
   `src/app/live/[id]/page.tsx` (`generateStaticParams` from mocks; `notFound()` otherwise).
4. Components `src/components/live/`: `live-card.tsx`, `live-player.tsx` (Stream player `<iframe>`
   when `playback` exists, else a poster + `live.playerUnavailable`), `live-badge.tsx`,
   `viewer-count.tsx`, `pinned-product-card.tsx` (add to cart via the existing cart store),
   `live-products-drawer.tsx`, `live-chat.tsx` (signed-out → `chatSignInPrompt` link to sign-in;
   there is no client auth yet, so treat the user as signed out unless a mock flag says otherwise),
   `reaction-button.tsx` (CSS float-up hearts, respects `prefers-reduced-motion`).
   Layout: mobile = video full-width with chat overlaid at the bottom; desktop = video + side panel.
5. Header nav link to `/live` using `live.nav`.
6. All text via `@repo/i18n` keys from Task D; all prices via `formatMoney`; follow `DESIGN.md` /
   `COMPONENTS.md` tokens; accessible names on icon buttons.

**Verify:** `pnpm --filter @apps/web typecheck` (or the app's equivalent script) and
`pnpm --filter @apps/web build` (static export emits `out/live/index.html` and one page per mock id).

### Task I — Docs (Haiku)

Given the lead's list of facts from tasks A–H, update: root `CLAUDE.md` (implementation status,
monorepo map with `packages/streaming` + `workers/`, naming row `@workers/<n>`), `server/CLAUDE.md`
(state + live endpoints + env), `packages/core/CLAUDE.md` (schemas list), `packages/db/CLAUDE.md`
(model/enum counts, new migrations, new partial indexes in the drift warning), `apps/client/CLAUDE.md`
(live pages), `SCREENS.md` (two storefront screens), `.env.example` (§1.7), spec status line.

**Verify:** `rg -n "live" <each file>` shows the new sections; `pnpm format:check` on changed docs.

### Task R — Review and commit (lead)

1. `code-reviewer` subagent over the full branch diff; lead verifies each finding, fixes real ones.
2. Full gate: `pnpm typecheck && pnpm test && pnpm build` (lint scripts are still TODO stubs).
3. One Conventional Commit per task (`feat(core): …`, `feat(streaming): …`, `feat(db): …`,
   `feat(i18n): …`, `feat(server): …`, `feat(workers): …`, `feat(client): …`, `docs: …`).
   No push.
