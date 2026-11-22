# Live Shopping (Livestream) Design

- **Date:** 2026-11-23
- **Status:** Implemented (MVP backend + storefront mock UI) 2026-11-23 — vendor broadcast console
  (`apps/admin`) and the Phase 0 real-account spike are still pending; see the plan
  `docs/superpowers/plans/2026-11-23-live-shopping.md` (its contracts supersede §4–§8 where they
  differ: adapter in `@repo/streaming`, worker in `workers/outbox`, extra `LiveSession` columns)
- **Owner:** `server/src/live` (API), `packages/core` (schemas), `packages/db` (models), `apps/client` (viewer), `apps/admin` (vendor broadcast console)
- **Constitution:** root `CLAUDE.md` Golden Rules + NEVER DO list
- **Video infrastructure:** Cloudflare Stream (Live Inputs)

## 1. Purpose

Let an ACTIVE vendor broadcast live video to customers, pin their own products during the
broadcast, and let viewers chat and add pinned products to the cart without leaving the stream.
The recording becomes a replay once the stream ends.

## 2. Scope

**MVP (this design)**

- One broadcaster (vendor) → many viewers. Vendor broadcasts from OBS / Larix / any RTMPS encoder.
- Vendor schedules a session, gets RTMPS credentials, previews, clicks **Go live**, ends it.
- Viewers (guest allowed) watch via HLS, see pinned products, viewer count and chat.
- Signed-in customers send chat messages and react; "Add to cart" from a pinned product uses the
  existing cart flow.
- Replay of the automatic recording after the session ends.
- Platform staff can terminate any live session (moderation).

**Out of scope (later phases, §10)**

- Broadcasting from the browser/phone without an encoder (WHIP).
- Co-hosting / guests on stream (needs Cloudflare Realtime SFU).
- Live-only prices / flash deals (must go through the coupon system — never a client-supplied price).
- Order attribution to a live session, follower notifications, chat replay, signed playback URLs.

## 3. Why Cloudflare Stream

| Need                        | Stream feature                                                                 |
| --------------------------- | ------------------------------------------------------------------------------ |
| Ingest from encoder         | Live Input → RTMPS / SRT URL + stream key (WHIP URL available for later phase) |
| Scalable playback           | HLS / DASH manifest per live input, served from Cloudflare's CDN               |
| Replay                      | `recording.mode = automatic` → each broadcast becomes a Stream video           |
| Know when encoder is on/off | Live input connected / disconnected notifications (webhook)                    |
| Know when replay is ready   | Stream video webhook (`readyToStream`)                                         |
| No transcoding infra to run | Fully managed; billed per minute stored + minute delivered                     |

Typical latency with HLS is a few seconds to ~20 s — acceptable for live shopping where the
interactive part (chat, pins) runs on our own low-latency channel (§7), not inside the video.

> Exact API field names, webhook payloads, pricing and account limits are verified in **Phase 0**
> (§9) and recorded back into this section before implementation starts.

## 4. Architecture

```
 Vendor encoder (OBS)                     Viewers (apps/client)
        │ RTMPS + stream key                 │ HLS (Stream player)      │ SSE + POST (chat/pins)
        ▼                                    ▼                          ▼
 ┌──────────────────────── Cloudflare Stream ───────┐          ┌──────────── server (@server/api) ───────────┐
 │ Live Input (1 per session) ──► HLS manifest      │          │ LiveModule                                  │
 │            └─► automatic recording → video       │          │  ├ VendorLiveController   /v1/vendor/live-… │
 │ Notifications: connected / disconnected ─────────┼─webhook─►│  ├ PublicLiveController   /v1/live-sessions │
 │ Stream webhook: recording ready ─────────────────┼─webhook─►│  ├ LiveWebhookController  /v1/webhooks/…    │
 └──────────────────────────────────────────────────┘          │  ├ LiveService (state machine)              │
        ▲                                                       │  ├ LiveRealtimeService (Redis pub/sub)      │
        │ create / delete live input                            │  └ StreamProvider (interface)               │
        │                                                       └───────────────┬─────────────────────────────┘
 ┌──────┴──────── workers/outbox (BullMQ) ─────────┐                            │ $transaction
 │ live_session.provision_requested → create input │◄──── outbox_events ────────┤
 │ live_session.ended → delete input               │                            ▼
 │ live_session.disconnect_grace → auto-end        │                      PostgreSQL + Redis
 └─────────────────────────────────────────────────┘
```

Rules applied:

- **No `await cloudflare()` in the request thread** (Golden Rule #9): creating/deleting live
  inputs goes through `outbox_events` → worker. See decision D1 for the dispatcher dependency.
- **Ownership** (Golden Rule #6): every vendor endpoint filters by `req.user.vendorId`; pinned
  products must belong to that vendor. Never accept `vendorId` from the body.
- **Webhooks** are authenticated (shared-secret header / HMAC signature, constant-time compare),
  idempotent (Redis dedupe on event id), and only drive guarded state transitions.
- **Cloudflare API token never leaves the server.** Only public playback URLs reach clients.

### 4.1 One live input per session

Each `LiveSession` gets its own Cloudflare live input.

- Pros: the webhook `liveInputId` maps 1:1 to a session; ending a session = deleting its input,
  so a stale playback URL can never show a later broadcast; recordings are naturally per-session.
- Cost: vendor pastes a new stream key into OBS per session. Acceptable for MVP; the WHIP phase
  (browser broadcasting) removes the copy step entirely.

## 5. Data model (`packages/db`)

New enum + two models. Money is not involved (prices come from `Product`/`ProductVariant`).

```prisma
enum LiveSessionStatus {
  SCHEDULED   // created; live input may still be provisioning (liveInputId = null)
  LIVE        // vendor clicked "Go live"; publicly listed
  ENDED       // terminal
  CANCELLED   // terminal; never went live
}

model LiveSession {
  id                 String            @id                       // ULID, LiveSessionId brand
  vendorId           String            @map("vendor_id")
  title              String                                       // vendor content, not translated
  status             LiveSessionStatus @default(SCHEDULED)
  scheduledAt        DateTime?         @map("scheduled_at")
  liveInputId        String?           @unique @map("live_input_id")   // Cloudflare uid
  encoderConnectedAt DateTime?         @map("encoder_connected_at")    // null = encoder offline
  startedAt          DateTime?         @map("started_at")
  endedAt            DateTime?         @map("ended_at")
  endReason          String?           @map("end_reason")              // VENDOR | DISCONNECT_TIMEOUT | TERMINATED
  recordingVideoId   String?           @map("recording_video_id")      // Cloudflare video uid
  peakViewers        Int               @default(0) @map("peak_viewers")
  createdById        String            @map("created_by_id")
  createdAt          DateTime          @default(now()) @map("created_at")
  updatedAt          DateTime          @updatedAt @map("updated_at")

  vendor    Vendor               @relation(fields: [vendorId], references: [id], onDelete: Restrict)
  createdBy User                 @relation(fields: [createdById], references: [id])
  products  LiveSessionProduct[]

  @@index([vendorId, status])
  @@index([status, startedAt])
  @@map("live_sessions")
}

model LiveSessionProduct {
  liveSessionId String    @map("live_session_id")
  productId     String    @map("product_id")
  position      Int
  pinnedAt      DateTime? @map("pinned_at")   // non-null = currently highlighted on stream

  liveSession LiveSession @relation(fields: [liveSessionId], references: [id], onDelete: Cascade)
  product     Product     @relation(fields: [productId], references: [id], onDelete: Restrict)

  @@id([liveSessionId, productId])
  @@index([productId])
  @@map("live_session_products")
}
```

- At most **one** pinned product per session — enforced in the service inside `$transaction`
  (unpin others + pin target), optionally backed by a partial unique index in a hand-written
  SQL migration (`WHERE pinned_at IS NOT NULL`).
- At most **one** `LIVE` session per vendor — partial unique index on `(vendor_id) WHERE status = 'LIVE'`.
- Chat is **not** stored in Postgres in MVP (Redis only, see §7). Stream keys are **not** stored
  (decision D2).
- Migration: `pnpm db:migrate dev --name add_live_sessions` (additive, forward-only).

## 6. State machine

```
            vendor cancel
 SCHEDULED ───────────────► CANCELLED
     │
     │ vendor "Go live" (requires liveInputId != null AND encoderConnectedAt != null)
     ▼
   LIVE ──── vendor end ─────────────────────┐
     │  ──── platform terminate ─────────────┤
     │  ──── disconnected > grace period ────┤
     ▼                                       ▼
                                           ENDED
```

- Every transition is a guarded update: `UPDATE live_sessions SET … WHERE id = $1 AND status = $expected`;
  0 rows → `live.invalid-transition` (safe under concurrent webhook + vendor click).
- `encoderConnectedAt` is set/cleared by the connected/disconnected webhooks independently of `status`.
- **Disconnect grace:** on `disconnected` while `LIVE`, enqueue `live_session.disconnect_grace`
  (delayed job, default 120 s, tunable via `PlatformSettings.live_disconnect_grace_seconds`).
  When it fires: if still disconnected → `ENDED` with `endReason = DISCONNECT_TIMEOUT`.
  An encoder reconnect inside the window keeps the session `LIVE` (OBS hiccups are common).
- Entering `ENDED` writes outbox `live_session.ended` → worker deletes the live input
  (recording video is kept) and publishes `session.ended` to viewers.
- Every transition writes its outbox event in the same `$transaction` (Golden Rules #4/#9).

## 7. Realtime channel (chat, pins, viewer count)

Recommended (decision D3): **Server-Sent Events down, HTTP POST up**.

- `GET /v1/live-sessions/:id/events` — SSE stream, public (guests can watch). Fastify streams
  events from a Redis pub/sub channel `live:{id}`; works across multiple API instances.
- `POST /v1/live-sessions/:id/messages` — `@Roles('CUSTOMER', …)`, JWT, `Idempotency-Key`,
  body `ChatMessageCreateSchema` (1–200 chars, trimmed). Rate limit: Redis token bucket per
  `(userId, sessionId)`, e.g. 1 msg / 2 s → `live.chat-rate-limited`.
- `POST /v1/live-sessions/:id/reactions` — same auth, aggregated per second before publishing.
- Recent chat: Redis Stream `live:{id}:chat` capped (`MAXLEN ~ 200`) so late joiners get history;
  expired 24 h after `ENDED`.
- Viewer count: each SSE connection heartbeats into a Redis sorted set `live:{id}:viewers`
  (member = connection id, score = last-seen ms); count = members seen in the last 30 s;
  broadcast every 5 s; `peakViewers` persisted on end.
- Event payload is a Zod discriminated union `LiveEventSchema` in `packages/core`:
  `chat.message | chat.deleted | reaction.burst | product.pinned | product.unpinned |
viewers.updated | session.live | session.ended`.

Why not WebSocket / Durable Objects for MVP: SSE needs no new protocol stack, stays inside the
OpenAPI/REST surface, reuses the existing JWT guard for writes and existing Redis. Durable Objects
would add a second runtime and a second auth implementation.

Moderation: vendor (owner/staff of that vendor) can delete a message and mute a user for the
session (`live:{id}:muted` Redis set). Platform staff can terminate the session.

## 8. API surface

All under `/v1`, kebab-case, use-case endpoints (no generic CRUD). Request/response shapes live
in `packages/core/src/schemas/live.ts`.

**Vendor** — `@Roles('VENDOR_OWNER', 'VENDOR_STAFF')` (see D4), scoped by `req.user.vendorId`

| Method | Path                                             | Purpose                                                       |
| ------ | ------------------------------------------------ | ------------------------------------------------------------- |
| POST   | `/vendor/live-sessions`                          | Create (title, scheduledAt?, productIds[]) → outbox provision |
| GET    | `/vendor/live-sessions`                          | List own sessions                                             |
| GET    | `/vendor/live-sessions/:id`                      | Detail incl. provisioning + encoder state                     |
| GET    | `/vendor/live-sessions/:id/ingest-credentials`   | RTMPS URL + stream key (D2)                                   |
| PUT    | `/vendor/live-sessions/:id/products`             | Replace product line-up (own ACTIVE products only)            |
| POST   | `/vendor/live-sessions/:id/products/:pid/pin`    | Pin one product (unpins the previous)                         |
| POST   | `/vendor/live-sessions/:id/products/:pid/unpin`  |                                                               |
| POST   | `/vendor/live-sessions/:id/go-live`              | SCHEDULED → LIVE                                              |
| POST   | `/vendor/live-sessions/:id/end`                  | LIVE → ENDED                                                  |
| POST   | `/vendor/live-sessions/:id/cancel`               | SCHEDULED → CANCELLED                                         |
| POST   | `/vendor/live-sessions/:id/messages/:mid/delete` | Moderate chat                                                 |
| POST   | `/vendor/live-sessions/:id/mutes`                | Mute a user for this session                                  |

**Public / customer**

| Method | Path                           | Auth         | Purpose                                       |
| ------ | ------------------------------ | ------------ | --------------------------------------------- |
| GET    | `/live-sessions?status=LIVE`   | public       | Currently live (and recent replays)           |
| GET    | `/live-sessions/:id`           | public       | Title, vendor, playback URL, products, pinned |
| GET    | `/live-sessions/:id/events`    | public (SSE) | Realtime events                               |
| POST   | `/live-sessions/:id/messages`  | CUSTOMER     | Send chat                                     |
| POST   | `/live-sessions/:id/reactions` | CUSTOMER     | Send reaction                                 |

Playback URL is only returned when `status = LIVE` (HLS of the live input) or `ENDED` with a
ready recording (HLS of the recording video). It is built server-side from
`CLOUDFLARE_STREAM_CUSTOMER_CODE` + uid.

**Platform** — `@Roles('PLATFORM_STAFF', 'PLATFORM_ADMIN')`

| Method | Path                                    | Purpose                     |
| ------ | --------------------------------------- | --------------------------- |
| GET    | `/platform/live-sessions?status=LIVE`   | Monitor                     |
| POST   | `/platform/live-sessions/:id/terminate` | Force end (reason required) |

**Webhooks** — no JWT; authenticated by secret/signature

| Method | Path                              | Source                                                      |
| ------ | --------------------------------- | ----------------------------------------------------------- |
| POST   | `/webhooks/cloudflare/live-input` | Cloudflare Notifications (connected / disconnected / error) |
| POST   | `/webhooks/cloudflare/stream`     | Stream video webhook (recording ready)                      |

Error codes (added to the `packages/core` catalog + vi/en in `packages/i18n`):
`live.not-found`, `live.invalid-transition`, `live.not-provisioned`, `live.encoder-offline`,
`live.product-not-owned`, `live.product-inactive`, `live.already-live`, `live.chat-rate-limited`,
`live.chat-muted`, `live.webhook-invalid-signature`.

## 9. Implementation phases

Each step lists its verification evidence (root `CLAUDE.md` §8).

### Phase 0 — Spike (no production code)

1. Enable Stream on a Cloudflare account; create an API token scoped to **Stream: Edit**.
   → verify: `curl` create live input returns uid + RTMPS URL + key.
2. Broadcast from OBS; play the HLS manifest in Safari + hls.js; measure latency.
   → verify: recorded latency numbers in this doc.
3. Configure Notifications webhook + Stream webhook to a `cloudflared` tunnel; capture real payloads
   and auth headers for connected / disconnected / recording ready.
   → verify: payload samples saved as test fixtures.
4. Confirm: how to stop an input accepting connections (delete vs disable), whether deleting an
   input keeps its recordings, current pricing, live input / concurrency limits.
   → verify: §3 updated with facts + doc links.

### Phase 1 — Domain foundation

1. `packages/core`: `LiveSessionId` brand, `LiveSessionStatus` enum mirror, `live.ts` schemas
   (create, products, chat message, `LiveEventSchema` union, public DTO), error codes.
   → verify: `pnpm --filter @repo/core test` (1 valid + 1 invalid per schema).
2. `packages/i18n`: vi/en for error codes + storefront/admin UI strings (`live.*` namespace).
   → verify: `pnpm --filter @repo/i18n test` (catalog parity test).
3. `packages/db`: enum + models + partial unique indexes; `PlatformSettings.live_disconnect_grace_seconds`
   (default 120); seed one ENDED demo session with a replay.
   → verify: `pnpm db:migrate dev --name add_live_sessions`, `pnpm db:seed` twice (idempotent).

### Phase 2 — Server live module

1. `StreamProvider` interface (`createLiveInput`, `deleteLiveInput`, `getIngestCredentials`,
   `playbackUrl`) + `CloudflareStreamProvider` + `FakeStreamProvider` (dev/test, selected by
   `LIVE_STREAM_PROVIDER=fake|cloudflare`). → verify: unit tests with mocked HTTP.
2. `LiveService` state machine + vendor endpoints + outbox writes.
   → verify: integration tests (Testcontainers): every transition, concurrent go-live vs
   disconnect, vendor A cannot touch vendor B's session or pin B's product, one LIVE per vendor.
3. Webhook controllers: signature check, Redis dedupe, map uid → session.
   → verify: tests with Phase 0 fixtures — bad signature 401, duplicate delivery no-op.
4. Worker handlers (`workers/outbox`): provision, delete input, disconnect grace.
   → verify: integration test — reconnect inside grace keeps LIVE; outside grace ends it.
5. Platform terminate endpoint. → verify: guard test (staff OK, vendor 403).

### Phase 3 — Realtime

1. SSE endpoint + Redis pub/sub fan-out + heartbeat/viewer count.
   → verify: integration test with 2 API instances sharing Redis receives the same event.
2. Chat/reaction POST + rate limit + mute + delete.
   → verify: tests for rate limit boundary, muted user rejected, guest rejected (401).

### Phase 4 — Storefront (`apps/client`)

1. `/[locale]/live` (live now + replays) and `/[locale]/live/[id]` (player, pinned product card,
   product drawer, chat, viewer count, reactions); add to cart reuses the existing cart store.
   Player: Cloudflare Stream Player iframe for MVP (swap to hls.js if overlays need it).
2. Add both screens to `SCREENS.md`; mock data first, consistent with the rest of the storefront,
   then switch to `@repo/sdk` when it is generated.
   → verify: Playwright smoke — open live page, see pinned product, add to cart.

### Phase 5 — Vendor broadcast console (`apps/admin`, blocked on admin scaffold)

Session list, create form with product picker, credentials panel (copy URL/key, OBS guide),
preview player, Go live / End buttons, pin controls, chat moderation.
→ verify: Playwright smoke against `FakeStreamProvider` (fake webhooks via a test endpoint).

### Phase 6 — Later

WHIP browser broadcasting · signed playback URLs · live-scoped coupons (flash deals) ·
`OrderItem.liveSessionId` attribution + vendor analytics · follower notifications via outbox ·
chat replay persisted to Postgres · co-hosting via Cloudflare Realtime.

## 10. Configuration

New env vars (`server/src/config/env.ts` + `.env.example`), separate from the CI
`CLOUDFLARE_API_TOKEN` (Pages-only scope):

| Var                                       | Purpose                                                   |
| ----------------------------------------- | --------------------------------------------------------- |
| `LIVE_STREAM_PROVIDER`                    | `fake` (default in dev/test) or `cloudflare`              |
| `CLOUDFLARE_STREAM_ACCOUNT_ID`            | Account owning the Stream subscription                    |
| `CLOUDFLARE_STREAM_API_TOKEN`             | Token scoped to Stream: Edit                              |
| `CLOUDFLARE_STREAM_CUSTOMER_CODE`         | Playback subdomain `customer-<code>.cloudflarestream.com` |
| `CLOUDFLARE_STREAM_WEBHOOK_SECRET`        | Verifies Stream video webhook signatures                  |
| `CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET` | Verifies live-input notification webhook                  |

Required only when `LIVE_STREAM_PROVIDER=cloudflare` (Zod `refine`), so local dev boots without
a Cloudflare account. Tunable business values (disconnect grace, chat rate) live in
`PlatformSettings`, not env.

Cost guard: Stream bills per minute delivered, so one 60-minute session watched by 500 viewers is
~30,000 delivered minutes. Phase 0 confirms current prices; add an alert on monthly Stream usage.

## 11. Open decisions

| #   | Decision                             | Options                                                                                                                          | Recommendation                         |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| D1  | Outbox dispatcher does not exist yet | (a) build `workers/outbox` (BullMQ) first — also needed by payments; (b) call Cloudflare synchronously as a documented exception | **(a)**                                |
| D2  | Where the stream key comes from      | (a) fetched from Cloudflare on demand (read-only, no side effect); (b) stored encrypted in DB at provisioning                    | **(a)** — no secret at rest            |
| D3  | Realtime transport                   | (a) SSE + POST; (b) WebSocket gateway (socket.io + Redis adapter); (c) Durable Objects                                           | **(a)**                                |
| D4  | Who can broadcast                    | (a) `VENDOR_OWNER` only; (b) owner + `VENDOR_STAFF`                                                                              | **(b)** — staff usually run the stream |
| D5  | Persist chat                         | (a) Redis only, 24 h; (b) Postgres for moderation/replay                                                                         | **(a)** for MVP                        |

## 12. Docs to update when implemented

Root `CLAUDE.md` (implementation status, monorepo map if `workers/` is added), `server/CLAUDE.md`,
`packages/db/CLAUDE.md`, `packages/core/CLAUDE.md`, `apps/client/CLAUDE.md`, `SCREENS.md`,
`.env.example`.
