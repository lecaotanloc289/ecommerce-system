# @repo/streaming

Live video provider abstraction for live shopping: Cloudflare Stream adapter, in-memory fake, and
verification/parsing for both Cloudflare webhook types. Node-only (`node:crypto`), `zod` is the
only dependency. No DB, no Nest, no `@repo/*` imports — used by `server` and `workers/outbox`.

## Layout

| Path                | What                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/provider.ts`   | `StreamProvider` interface, `StreamProviderError` (`status?`, `retryable`), id/customer-code validation              |
| `src/cloudflare.ts` | `CloudflareStreamProvider` — fetch-based, Bearer token, every response parsed with Zod                               |
| `src/fake.ts`       | `FakeStreamProvider` — deterministic (input id = sha256(sessionId)[0..32]), `inspectLiveInput()` helper              |
| `src/webhooks.ts`   | `verifyNotificationWebhook`, `verifyStreamWebhookSignature`, `parseLiveInputNotification`, `parseStreamVideoWebhook` |
| `src/index.ts`      | Re-exports + `createStreamProvider({ provider: 'fake' \| 'cloudflare', … })`                                         |
| `test/fixtures/`    | Doc-shaped Cloudflare payloads (see "Fixtures" below)                                                                |

## Rules specific to this package

- **API is a shared contract** (plan `docs/superpowers/plans/2026-11-23-live-shopping.md` §1.6).
  `server` and `workers/outbox` code against it — change names/signatures only together with them.
- **Errors:** network failure, timeout (default 10 s), 5xx, 408, 429 → `retryable: true`; other
  4xx, malformed response, invalid argument → `retryable: false`. `retireLiveInput` treats 404 as
  success. Error messages carry operation + HTTP status + up to 3 Cloudflare `code message` pairs —
  never the API token, never a response body (a credentials body contains the stream key).
- **Ids are validated before they go into a URL path** (`^[A-Za-z0-9]{1,32}$`, Cloudflare documents
  `maxLength: 32`); invalid → non-retryable `StreamProviderError`, no request sent.
- **Webhook helpers are total:** malformed headers/bodies return `false` / `null`, never throw.
  Both auth checks are constant-time (`crypto.timingSafeEqual`).
- **Raw body:** `verifyStreamWebhookSignature` needs the request body bytes exactly as received.
  The server must capture the raw body before JSON parsing; re-serialised JSON will not verify.
- **Clock is injected** (`nowSeconds`); default tolerance 300 s, applied in both directions.

## Cloudflare docs — sources and findings (verified 2026-11-23)

| Topic                               | Source                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live input create/get/update/delete | <https://developers.cloudflare.com/stream/stream-live/start-stream-live/>, API ref <https://developers.cloudflare.com/api/resources/stream/subresources/live_inputs/> (`methods/create`, `get`, `update`, `delete`) |
| Playback URLs                       | <https://developers.cloudflare.com/stream/stream-live/watch-live-stream/>                                                                                                                                           |
| Recordings                          | <https://developers.cloudflare.com/stream/stream-live/replay-recordings/>                                                                                                                                           |
| Stream (video) webhook + signature  | <https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/>                                                                                                                                     |
| Live input notifications            | <https://developers.cloudflare.com/stream/stream-live/webhooks/>, error codes <https://developers.cloudflare.com/stream/stream-live/troubleshooting/>                                                               |
| `cf-webhook-auth`                   | <https://developers.cloudflare.com/notifications/get-started/configure-webhooks/>, <https://developers.cloudflare.com/notifications/reference/webhook-payload-schema/>                                              |
| Video object (`liveInput`)          | <https://developers.cloudflare.com/api/resources/stream/methods/get/>                                                                                                                                               |

**Live inputs** (`https://api.cloudflare.com/client/v4/accounts/{account_id}/stream/live_inputs`,
`Authorization: Bearer <token>`, v4 envelope `{ success, errors[{code,message}], messages, result }`):

- `POST` body `{ meta: { name }, recording: { mode: 'automatic' } }` (exactly the docs example).
  `meta` is a free-form key-value store; `name` is only shown in examples. Result has `uid`
  (≤ 32 chars), `rtmps: { url: 'rtmps://live.cloudflare.com:443/live/', streamKey }`, `srt`,
  `webRTC`, `recording`, `enabled`, `status`, … — every result field is marked optional in the
  API schema, so we require only what we use (`uid`; `rtmps.url` + `rtmps.streamKey` on GET).
- The create endpoint lists an optional `Idempotency-Key` header (≤ 255 chars) with **no documented
  semantics**. We send `Idempotency-Key: <liveSessionId>` so a worker retry after a lost response
  can be deduped if Cloudflare honours it; harmless if it does not.
- `GET /{uid}` returns the RTMPS stream key (decision D2: fetched on demand, never stored).
- `PUT /{uid}` with `enabled: false` "rejects incoming RTMPS and SRT connections" and can terminate
  an active broadcast. Whether `PUT` is a full replace (resetting omitted fields such as
  `recording.mode`) is **not documented**.
- `DELETE /{uid}`: "Permanently delete a live input, making it inaccessible and blocking current
  and future broadcasts to it. Existing recordings will be retained." Success example body: `{}`.

**`retireLiveInput` decision: `DELETE`**, 404 = already done. It is the only option the docs
explicitly say keeps recordings, it avoids the undocumented `PUT` replace semantics, and it means a
stale live playback URL can never show a later broadcast (spec §4.1). The success body is not
parsed (only `{}` is documented). Recordings are separate Stream videos with their own ids; the
input's `/videos` listing becomes unreachable after delete, so the server must learn recording ids
from the Stream video webhook (or store them) — not by listing the input later.

**Playback** (pure, no API call): `https://customer-<CODE>.cloudflarestream.com/<INPUT_ID|VIDEO_ID>/manifest/video.m3u8`
and `…/iframe`. The live input id always points at the current broadcast; a video id points at one
recording.

**Stream video webhook** (account-wide, `PUT /accounts/{id}/stream/webhook` with
`notificationUrl`; the response returns the `secret`):

- Header `Webhook-Signature: time=<unix seconds>,sig1=<hex>`; `sig1` = HMAC-SHA256(secret,
  `time + "." + rawBody`), hex. Docs say to drop "too old" timestamps (no value given → we default
  to 300 s) and to compare in constant time. We ignore unknown keys and accept if any `sig1`
  matches; duplicate `time`, non-integer time, or non-64-hex `sig1` → reject.
- Payload = the Video object: `uid`, `readyToStream`, `status { state, pctComplete,
errorReasonCode, errorReasonText }`, `meta`, `playback { hls, dash }`, `duration`, … The Video
  object schema has `liveInput` ("The live input ID used to upload a video with Stream Live").
  Missing/null `readyToStream` → `false`.

**Notifications "Stream Live Input" webhook** (configured in dashboard → Notifications →
generic webhook destination with a user-chosen secret):

- Auth: Cloudflare sends the secret verbatim in `cf-webhook-auth` — "reject any requests where this
  header is missing or does not match". No HMAC. We SHA-256 both sides then `timingSafeEqual`.
- Payload: `{ name, text, ts (unix s), data: { notification_name: 'Stream Live Input', input_id,
event_type: 'live_input.connected' | 'live_input.disconnected' | 'live_input.errored',
updated_at (RFC 3339, ns) } }`; errored adds `data.live_input_errored: { error: { code, message },
video_codec, audio_codec }`. Generic schema also lists optional `account_id`, `policy_id`,
  `alert_type`, … (not used). `occurredAt` = `updated_at` (truncated to ms), else `ts`.

## Open uncertainties (resolve in the Phase 0 spike with a real account)

1. **Video webhook for live recordings:** the docs never state that the Stream video webhook fires
   for live recordings, nor that its payload includes `liveInput` (only the `/live_inputs/{uid}/videos`
   REST sample and the Video schema show it). `parseStreamVideoWebhook` returns
   `liveInputId: null` when absent; the server must tolerate that (e.g. map by video id, or ignore).
2. **Delete during/just after a broadcast:** docs say existing recordings are retained; whether a
   recording still being finalised (≤ 60 s after the stream ends) is retained when the input is
   deleted mid-broadcast is not stated. The outbox runs retire after `ENDED`, which is usually
   after the encoder stopped — confirm with a real input.
3. **`Idempotency-Key` on create:** accepted by the API schema, semantics undocumented.
4. **Error codes in fixtures:** `test/fixtures/api-error-not-found.json` uses code `10003`
   illustratively; the actual Stream 404 code is not documented. Our logic keys off HTTP status only.
5. **429 / 408 retryable:** the plan said "4xx → not retryable"; rate-limit and request-timeout are
   transient, so they are retryable here (deliberate deviation).

## Fixtures

`live-input-created.json` (start-stream-live example), `live-input-get.json` (API reference example,
URLs filled in), `stream-video-ready.json` (using-webhooks example, verbatim),
`notification-live-input-disconnected.json` (stream-live/webhooks example; `text` reconstructed),
`notification-live-input-{connected,errored}.json` (same shape; errored per troubleshooting page),
`stream-video-live-recording.json` (Video object + `liveInput`, **assumed** — see uncertainty 1).

## Commands

- `pnpm --filter @repo/streaming typecheck` — `tsc` for `src/` and `test/`
- `pnpm --filter @repo/streaming test` — Vitest, mocked `fetch`, no network or services
- `pnpm --filter @repo/streaming build` — tsup → `dist/` (ESM + CJS + d.ts)
