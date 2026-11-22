# @workers/outbox

Outbox worker (Golden Rule #9). Services write `outbox_events` rows in the same transaction as
the business change; this process moves them onto BullMQ and runs their side effects (provider
calls, delayed jobs, Redis publishes). Generic dispatcher + per-domain handlers — payments will
reuse it. Read the root `CLAUDE.md` first; the live-shopping contracts are in
`docs/superpowers/plans/2026-11-23-live-shopping.md` §1 (outbox payloads §1.4, Redis keys §1.5,
state machine §1.8).

Depends on `@repo/core` (schemas), `@repo/db` (the `prisma` singleton, used directly — no Nest
here), `@repo/streaming`. Never imports `server/` or `apps/*`.

## Layout

| Path                           | What                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `src/main.ts`                  | Entry: parse env, build app, `SIGINT`/`SIGTERM` → graceful stop                          |
| `src/app.ts`                   | Wiring: Redis connections, queues, workers, registry, dispatcher; `start()` / `stop()`   |
| `src/env.ts`                   | Zod env (`parseEnv`, `streamProviderConfig`)                                             |
| `src/logger.ts`                | pino (`pino-pretty` only when `NODE_ENV=development`)                                    |
| `src/dispatcher.ts`            | `OutboxDispatcher` — poll loop, `FOR UPDATE SKIP LOCKED`, `OutboxJobDataSchema`          |
| `src/queues.ts`                | Queue names + default job options (retry policy)                                         |
| `src/handlers/registry.ts`     | `HandlerRegistry`, `createOutboxProcessor` (routing, failure bookkeeping, error mapping) |
| `src/handlers/live-session.ts` | `live_session.*` handlers                                                                |
| `src/grace.ts`                 | Disconnect grace job: scheduling + the guarded `LIVE → ENDED (DISCONNECT_TIMEOUT)`       |
| `src/live-events.ts`           | Redis key helpers, `publishLiveEvent` (validates with core `LiveEventSchema`), TTLs      |
| `src/ulid.ts`                  | Local ULID generator (the `ulid` package is not a dependency here)                       |
| `src/retry-failed.ts`          | Ops CLI: re-run failed jobs with a fresh retry budget (see "Ops")                        |

## How it works

**Dispatcher** (every `OUTBOX_POLL_INTERVAL_MS`, immediately again after a full batch): one
transaction (`maxWait` 5 s, `timeout` 10 s) → `SELECT … FROM outbox_events WHERE processed_at IS
NULL ORDER BY created_at, id LIMIT n FOR UPDATE SKIP LOCKED` → `addBulk` to queue `outbox` with
`jobId = outbox id` → set `processed_at = now()`. Safe with N replicas (rows are never claimed
twice). The dispatcher's queue has its own Redis connection with `enableOfflineQueue: false`, so a
Redis outage fails the enqueue immediately and the transaction rolls back (rows stay unclaimed).
If the enqueue succeeds but the commit fails, the rows are re-claimed and BullMQ dedupes on
`jobId` as long as the completed job is still retained (24 h, age-only); handlers are idempotent
either way. `processed_at` means "handed to the queue", not "handled".

**Queues**

| Queue                   | Job data                                                              | jobId                    |
| ----------------------- | --------------------------------------------------------------------- | ------------------------ |
| `outbox`                | row snapshot `{ id, aggregateType, aggregateId, eventType, payload }` | outbox id                |
| `live-disconnect-grace` | `{ liveSessionId, disconnectedAt }` (delayed)                         | `grace-{sessionId}-{ms}` |

BullMQ forbids `:` in custom job ids, so the plan's `grace:{id}:{ms}` is written with `-`.

**Retry policy** (`DEFAULT_JOB_OPTIONS` + `WORKER_SETTINGS`, both queues): 15 attempts, custom
`capped-exponential` backoff 2 s, 4 s, … 512 s, then 10 min each (~67 min of retries in total).
Completed jobs kept 24 h, failed jobs 7 days (by age only). On every `outbox` failure the
processor increments `outbox_events.attempts` and stores `last_error` (≤ 1000 chars). Permanent
failures throw BullMQ `UnrecoverableError` (no retry): a `StreamProviderError` with
`retryable === false`, or `InvalidOutboxPayloadError` (the row fails its core schema). Other
errors — including `LiveEventValidationError` when building a realtime event — are retried.
Failures are logged with a `stage` (`job-data` | `handler` for `outbox`; `job-data` |
`transition` | `publish` | `reschedule` for the grace queue). Event types with no handler are
logged and **completed** (another domain may add a handler later).

**Live-session handlers** (payloads = core `LiveOutboxEventSchema`):

| Event                               | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live_session.provision_requested`  | Skip if session missing / `CANCELLED` / `ENDED`. If no input yet: adopt an id from `live:provision-pending:{id}` (left by a failed attempt) or `createLiveInput` and `SADD` it there **before** the DB write → `updateMany where { id, liveInputId: null, status in (SCHEDULED, LIVE) }`. Every pending id that did not end up stored is retired, then `SREM`ed (a failed retire rethrows → the retry retires that same id). Publish `session.provisioned` (also on replay). |
| `live_session.started`              | Log only (placeholder for follower notifications).                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `live_session.encoder_disconnected` | Add a delayed `live-disconnect-grace` job; delay = `disconnectedAt + PlatformSettings.liveDisconnectGraceSeconds − now` (≥ 0).                                                                                                                                                                                                                                                                                                                                               |
| `live_session.ended` / `cancelled`  | `retireLiveInput(liveInputId)` when non-null.                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Grace job** (§1.8, same guard as the server): one transaction — guarded `updateMany(status =
LIVE, encoderConnectedAt IS NULL, encoderDisconnectedAt <= now − grace)` → `ENDED`,
`endReason = DISCONNECT_TIMEOUT`, `peakViewers = max(db, Redis live:{id}:peak)` + outbox
`live_session.ended`; after commit publish `session.ended` and `EXPIRE 86400` on
`chat`/`viewers`/`peak`/`muted`. Reconnected or no longer LIVE → no-op. Still disconnected but the
latest disconnect is younger than grace (disconnect → reconnect → disconnect, clock skew, raised
grace) → re-schedule for that disconnect (same jobId its own event uses, so they dedupe; a unique
suffix if that is the running job itself). Already ended by DISCONNECT_TIMEOUT → re-publish only.

## Known limits

- **Orphaned live input — crash window.** If the process dies after `createLiveInput` returns but
  before the id is `SADD`ed to `live:provision-pending:{id}` (one Redis round-trip), the retry
  creates a second input and the first is never retired. A lost create _response_ (timeout, retried
  as retryable) has the same effect. We send `Idempotency-Key: <liveSessionId>` on create; whether
  Cloudflare honours it is unconfirmed (Phase 0 spike, `packages/streaming/CLAUDE.md` uncertainty
  3). If it does not, the planned mitigation is a reaper that lists live inputs and retires those
  whose `meta.name` (= session id) does not match a stored `liveInputId` — needs a list method on
  `StreamProvider` (not in this plan).
- **Pending ids after a permanent failure.** A non-retryable retire error leaves the id in
  `live:provision-pending:{id}` (TTL 7 days, logged at error level); delete that input by hand
  (Cloudflare dashboard or `DELETE …/stream/live_inputs/{uid}`), then `DEL` the key.
- **Redis must be durable:** `maxmemory-policy noeviction` (BullMQ requirement — evicted job keys
  lose jobs silently) and AOF persistence (`appendonly yes`) in every non-local environment;
  delayed grace jobs and pending ids live only in Redis.

## Ops

- `outbox_events.processed_at` = handed to BullMQ; `attempts` = how many times a handler failed
  for this row (never reset); `last_error` = the latest failure. A row with `processed_at` set and
  `last_error` not null is failing or failed; check the job state in the `outbox` queue (jobId =
  row id).
- **Re-run failed jobs** (kept 7 days) with a fresh retry budget:
  ```bash
  pnpm --filter @workers/outbox retry-failed                         # all failed, both queues
  pnpm --filter @workers/outbox retry-failed outbox <outboxId> …     # specific rows
  pnpm --filter @workers/outbox retry-failed live-disconnect-grace   # one queue
  ```
  (needs `REDIS_URL` and a build — it runs `node dist/retry-failed.js`).
- **Older than 7 days** (job already removed): `UPDATE outbox_events SET processed_at = NULL WHERE
id = '<id>'` — the dispatcher re-enqueues it on the next tick.

## Env

| Var                               | Default       | Notes                                                        |
| --------------------------------- | ------------- | ------------------------------------------------------------ |
| `DATABASE_URL`, `REDIS_URL`       | — (required)  |                                                              |
| `NODE_ENV`                        | `development` | `development` \| `test` \| `production`                      |
| `LOG_LEVEL`                       | `info`        | pino level                                                   |
| `LIVE_STREAM_PROVIDER`            | `fake`        | `fake` \| `cloudflare`; `fake` is **rejected in production** |
| `CLOUDFLARE_STREAM_ACCOUNT_ID`    | —             | required when `cloudflare`                                   |
| `CLOUDFLARE_STREAM_API_TOKEN`     | —             | required when `cloudflare` (Stream: Edit)                    |
| `CLOUDFLARE_STREAM_CUSTOMER_CODE` | —             | required when `cloudflare`                                   |
| `OUTBOX_POLL_INTERVAL_MS`         | `1000`        | idle poll interval                                           |
| `OUTBOX_BATCH_SIZE`               | `50`          | rows per claim (1–500)                                       |
| `OUTBOX_CONCURRENCY`              | `5`           | parallel jobs per queue per replica (1–100)                  |

Empty strings count as unset. Invalid env aborts startup with a list of every bad key. Like the
server, the worker does not read `.env` itself (Doppler or your shell).

## Add a handler (new domain)

1. Define the payload schema in `@repo/core` (discriminated on `eventType`), written by the
   service in the same transaction as the business change.
2. Add `src/handlers/<domain>.ts` exporting `register<Domain>Handlers(registry, deps)`; each
   handler `safeParse`s the row with the core schema and throws `InvalidOutboxPayloadError` on
   failure (permanent), and must be
   **idempotent** (at-least-once delivery). Throw `StreamProviderError`-style errors with a
   `retryable` flag, or extend `isPermanentFailure` in `registry.ts` for new permanent errors.
3. Register it in `src/app.ts`; add delayed/secondary queues to `src/queues.ts` and close them in
   `stop()`.
4. Test against real Postgres + Redis (below).

## Run

```bash
pnpm --filter @workers/outbox dev          # tsx watch (needs DATABASE_URL, REDIS_URL)
pnpm --filter @workers/outbox build        # tsup → dist/main.js
pnpm --filter @workers/outbox start        # node dist/main.js
pnpm --filter @workers/outbox typecheck    # src + test
pnpm --filter @workers/outbox test         # Vitest (needs Docker)
```

## Tests

`test/global-setup.ts` starts a throwaway `postgres:16-alpine` and `redis:7-alpine` with the
**Docker CLI** on random 127.0.0.1 ports, runs `prisma migrate deploy` from `packages/db`, and
`provide`s the URLs; `test/setup-env.ts` sets `DATABASE_URL`/`REDIS_URL` in each test worker
before `@repo/db` is imported. Containers are removed on teardown. The local dev DBs (5432/5433)
are never touched. (`@testcontainers/*` is not a dependency of this workspace; switch to it once
it is.) `@repo/core`, `@repo/db`, `@repo/streaming` must be built first (turbo does this).

Files: `env.test.ts`, `dispatcher.test.ts` (ordering, jobId, two concurrent dispatchers claim
each row once and both claim some, loop start/stop, stop during an in-flight tick, failing enqueue
leaves `processed_at` NULL), `live-session.test.ts` (handlers with `FakeStreamProvider` +
`inspectLiveInput`: provision happy/replay/skip/three races, failed race-loss retire retried,
pending-input adoption, retire, grace scheduling),
`grace.test.ts` (end + outbox + publish + TTL, idempotent replay, reconnect, disconnect →
reconnect → disconnect, skew re-schedule, vendor-ended no-op), `processor.test.ts` (real BullMQ:
unknown type completes, non-retryable not retried, retryable exhausts attempts, bad payload
permanent, malformed grace job unrecoverable, retry policy + permanent-failure classification,
end-to-end app provision → retire → stop).
