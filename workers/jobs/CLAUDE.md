# workers/jobs — background worker (`@workers/jobs`)

Runs every side effect outside the request thread (Golden Rule #9, roadmap D2/D10): the outbox
dispatcher and its handlers (provider payment sessions, transactional email). No HTTP server.
Read the root `CLAUDE.md` first. Depends only on `@repo/db`, `@repo/core`, `@repo/payments`,
`@repo/i18n` — never on `server/` or `apps/*`; it talks to the API only through the DB.

## Layout

| Path                                | What                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/main.ts`                       | Entry: env → logger → Redis ping → mailer + providers → dispatcher loop; SIGTERM/SIGINT stop |
| `src/env.ts`                        | Zod env (`parseEnv`); invalid → one error listing every key, exit 1                          |
| `src/logger.ts`                     | pino JSON logger + `describeError` (one line, emails replaced by `[email]`, ≤ 1000 chars)    |
| `src/redis.ts`                      | ioredis connection for BullMQ (`maxRetriesPerRequest: null`), pinged at boot                 |
| `src/outbox/dispatcher.ts`          | `OutboxDispatcher` (claim / process / backoff / dead-letter), `DEAD_LETTER_AT`               |
| `src/outbox/handler.ts`             | `defineHandler(schema, fn, { secretKeys? })`, `HandlerContext { tx, log, event }`            |
| `src/outbox/errors.ts`              | `PermanentError` — dead-letter now, no retry                                                 |
| `src/handlers/index.ts`             | `createHandlers(deps)` — one handler per `OUTBOX_EVENT_SCHEMAS` type (compile-time checked)  |
| `src/handlers/payment-requested.ts` | `payment.requested` → `PaymentProvider.createSession`                                        |
| `src/handlers/notifications.ts`     | email handlers                                                                               |
| `src/email/mailer.ts`               | `Mailer` interface + nodemailer SMTP implementation                                          |
| `src/email/templates.ts`            | Pure renderers → `{ subject, text, html }`, all text from `@repo/i18n` `email.*`             |
| `src/payments/providers.ts`         | Builds VNPay / Stripe from env; missing credentials → provider absent (disabled)             |

## Outbox dispatcher — semantics

**Design choice:** handlers run **in-process from the dispatcher**, one DB transaction per event —
not "poll → enqueue BullMQ job → mark processed". Reason: the outbox row already has `attempts`,
`last_error` and `next_attempt_at`, so retry state lives next to the event; a handler's DB writes
commit atomically with the "processed" mark (exactly-once for DB effects); and there is no second
queue whose state can diverge from the table. BullMQ is kept for T3.2's repeatable jobs.

1. **Claim** (single autocommit `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`):
   `processed_at IS NULL AND next_attempt_at <= now()`, oldest `created_at` first, `LIMIT
OUTBOX_BATCH_SIZE`; sets `attempts = attempts + 1` and `next_attempt_at = now() + lease (5 min)`.
   Other dispatchers skip locked rows and no longer see claimed ones as due.
2. **Process** each claimed event (`OUTBOX_CONCURRENCY` in parallel) in its own interactive
   transaction (timeout 60 s): `SELECT … WHERE id = ? AND processed_at IS NULL AND attempts =
<claimed> FOR UPDATE SKIP LOCKED` — no row means another dispatcher re-claimed it after the lease
   expired, so skip. The row lock is held while the handler runs, so **two dispatchers never handle
   the same event concurrently**. The handler runs inside `SAVEPOINT`; success →
   `processed_at = now()` in the same transaction.
3. **Failure** → `ROLLBACK TO SAVEPOINT` (handler writes discarded), `last_error` (scrubbed),
   `next_attempt_at = now() + backoff(attempt)` — 5 s, 10 s, 20 s, … capped at 1 h.
4. **Dead-letter** after attempt 10, or at once for a `PermanentError` (invalid payload, provider
   refused, provider not configured, referenced row missing): `processed_at` stays NULL,
   `next_attempt_at = 9999-12-31` (`DEAD_LETTER_AT`; not `infinity` so Prisma can read it), logged
   at `error`. Find them: `SELECT id, event_type, attempts, last_error FROM outbox_events WHERE
processed_at IS NULL AND next_attempt_at = '9999-12-31'`. Requeue: `UPDATE outbox_events SET
attempts = 0, next_attempt_at = now() WHERE id = '…'`.
5. **Crash / transaction timeout** mid-handler: nothing recorded, the claim's lease delays the
   retry by 5 min and the attempt still counts — so a poison event that kills the process is
   dead-lettered too (a claimed `attempts` above the max is dead-lettered without running).
6. **Unknown event type** (API newer than the worker): treated as a transient failure — retried
   with backoff, so deploying the newer worker within the ~2 h backoff window picks it up; after
   that it is dead-lettered.
7. **Shutdown** (SIGTERM): stop claiming, finish in-flight events, hand claimed-but-unstarted ones
   back (`attempts - 1`, due now). `fly.toml` `kill_timeout = 90s`.

Delivery is **at-least-once** for effects outside the DB (email, provider session) and
exactly-once for writes through `ctx.tx`. Handlers must be idempotent: re-read current state, act
only if still needed. Per-event ordering is not guaranteed (events of one order may run in
parallel) — handlers re-read state rather than relying on order.

**Sizing:** each in-flight event holds a DB connection for the handler's duration (incl. SMTP /
Stripe calls). Keep `OUTBOX_CONCURRENCY` (default 2) below Prisma's pool (`connection_limit` in
`DATABASE_URL`; default `2 × CPUs + 1`). A claimed batch must finish within the 5-min lease — with
slow handlers lower `OUTBOX_BATCH_SIZE`; overrun is safe (re-claimed events are skipped here) but
burns attempts.

**Clock:** due-ness uses Postgres `now()`, while the API's Prisma client fills
`next_attempt_at @default(now())` from its own clock; app/DB skew only delays events by that skew.

## Handlers (`OUTBOX_EVENT_SCHEMAS` in `@repo/core/schemas/outbox`)

| Event                                                                                                 | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment.requested {orderId, paymentId, provider, attemptNo}`                                         | Load Payment (row's provider is authoritative). Not PENDING or already has `redirectUrl` → no-op. Amount 0 → no-op (log): providers reject 0; confirming a free order is T3.1's job. Provider not configured → dead-letter. Else `createSession({ amount, returnUrl, ipAddr: clientIp ?? '127.0.0.1', locale: customer primaryLocale, description: i18n })` then `UPDATE payments SET redirect_url, expires_at, provider_ref WHERE id AND status = 'PENDING'` (0 rows = attempt failed meanwhile → session discarded). `payment.error.provider-unavailable` / unknown errors → retry; `common.error.validation-failed`, `money.error.currency-mismatch`, `money.error.invalid-operand`, `payment.error.amount-mismatch` → dead-letter. VNPay return URL `${API_PUBLIC_URL}/v1/payments/return/vnpay`; Stripe `${WEB_ORIGIN}/{locale}/order/success?orderId=`. |
| `order.created`                                                                                       | Customer email "order received" + total + payment deadline; skipped if the order is no longer AWAITING_PAYMENT                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `order.paid`, `order.cancelled` (reason)                                                              | Customer email                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `sub-order.shipped {orderId, subOrderId, customerId}`                                                 | Customer email: vendor name, carrier + tracking number                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `payout.released {subOrderId, vendorId}`                                                              | Vendor owner email: net = subtotal + shipping − vendor discount − commission (D7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `vendor.application.approved {applicationId, vendorId, userId}` / `.rejected {applicationId, userId}` | Applicant email (+ `rejectReason`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `vendor.invitation.created {invitationId, vendorId, email, token}`                                    | Email to the invitation's address with `ADMIN_ORIGIN/invite?token=`. Token must hash to the stored `token_hash` (else dead-letter); revoked / accepted / expired → skipped. Declared `secretKeys: ['token']`: the dispatcher strips `token` from the stored payload when the event is processed **or** dead-lettered (kept only while retries need it). Never log payloads. Invitee locale = matching user's, else `vi`.                                                                                                                                                                                                                                                                                                                                                                                                                                      |

- **Email:** recipient = `User.email` re-read from the DB, locale = `User.primaryLocale`. A user
  without email (Facebook-only sign-in) → skipped, event processed, logged at info with the user id.
  Templates: subject + text + simple HTML (all interpolated text HTML-escaped), money via
  `formatMoney`, dates via `formatDateTime` (Asia/Ho_Chi_Minh). Order links:
  `${WEB_ORIGIN}/{locale}/order/track?orderId=`; vendor links: `ADMIN_ORIGIN`.
- **PII:** log ids only. `describeError` replaces email addresses in `last_error` / logs (SMTP
  rejections echo the recipient). pino `redact` covers `email` / `to` / `redirectUrl` as a net.
- **Adding an event:** schema in core `OUTBOX_EVENT_SCHEMAS` → the `satisfies` in
  `src/handlers/index.ts` fails until a handler exists → `defineHandler(schema, fn)`; throw
  `PermanentError` for unfixable input; use `ctx.tx` for DB writes.

## Env

`DATABASE_URL`, `REDIS_URL` (required); `WEB_ORIGIN`, `ADMIN_ORIGIN`, `API_PUBLIC_URL`; `SMTP_HOST`
(localhost), `SMTP_PORT` (1025; 465 = implicit TLS), `SMTP_USER` + `SMTP_PASS` (optional, together),
`SMTP_FROM`; `VNPAY_TMN_CODE` + `VNPAY_HASH_SECRET` + `VNPAY_PAY_URL` + `VNPAY_API_URL` (all four →
VNPay enabled); `STRIPE_SECRET_KEY` (→ Stripe enabled; `STRIPE_WEBHOOK_SECRET` optional, unused here);
`OUTBOX_POLL_INTERVAL_MS` (1000), `OUTBOX_BATCH_SIZE` (50), `OUTBOX_CONCURRENCY` (2), `LOG_LEVEL`,
`NODE_ENV`. A disabled provider does not stop the worker: its `payment.requested` events dead-letter
with `payment provider X is not configured`. The worker does not read `.env`: use Doppler or export.

## Deploy

Separate Fly app `elma-worker-{dev,prod}` (`fly.toml`: no `[http_service]`, `kill_timeout 90s`),
image from `Dockerfile` (Node 22, build context = repo root, `Dockerfile.dockerignore` beside it;
keeps the pnpm layout so workspace symlinks + the generated Prisma client resolve).
`.github/workflows/deploy-worker.yml` deploys on push to `dev` / `prod`. One machine is enough;
more are safe (claims skip locked rows). Migrations are not run by the worker.

## Commands

```bash
pnpm --filter @workers/jobs dev        # tsup --watch + restart (needs DATABASE_URL, REDIS_URL; Mailhog for SMTP)
pnpm --filter @workers/jobs build      # tsup → dist/main.js (ESM)
pnpm --filter @workers/jobs start      # node dist/main.js
pnpm --filter @workers/jobs test       # Vitest + Testcontainers Postgres (Docker required)
pnpm --filter @workers/jobs lint       # ESLint (shared type-checked config), 0 warnings
pnpm --filter @workers/jobs typecheck  # tsc for src + test
```

Tests (`test/`): `global-setup.ts` starts one throwaway Postgres 16 container per run and applies
the real migrations with `prisma migrate deploy` (never the shared local DB); `setup-env.ts` points
the `@repo/db` singleton at it; files run sequentially and `resetDb()` truncates. `FakeMailer` and
fake `PaymentProvider`s replace SMTP / gateways. `insertEvent` back-dates `next_attempt_at` by 1 s
(host vs Docker-VM clock skew). Covers: parallel dispatchers never double-handle, backoff + retry
success, rollback of failed handler writes, dead-letter (max attempts, permanent, crashed last
attempt), lease takeover, shutdown release, payment session write / skips / retry / dead-letter,
email rendering vi + en, null-email skip, invitation token scrub.

## For T3.2 (scheduled jobs)

Add them here: a BullMQ `Queue` + `Worker` on the `connectRedis()` connection with repeatable jobs
(fixed `jobId` per job = distributed lock), started from `main.ts` next to the dispatcher and closed
on shutdown. Jobs that write business state should emit outbox events (`payout.released`,
`order.cancelled` with `PAYMENT_EXPIRED`, `refund.requested`) rather than send email directly —
the handlers above already exist for the first two. `refund.requested` needs a new handler (and
`sub-order.delivered` / `sub-order.completed` if emitted) — the compile-time `satisfies` forces it.
Zero-amount payments are left PENDING by this worker: T3.1 must confirm them.
