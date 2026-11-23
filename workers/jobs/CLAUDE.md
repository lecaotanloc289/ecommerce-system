# workers/jobs — background worker (`@workers/jobs`)

Runs every side effect outside the request thread (Golden Rule #9, roadmap D2/D10): the outbox
dispatcher and its handlers (provider payment sessions, zero-amount confirmation, provider refunds,
transactional email) and the scheduled jobs (payment expiry, auto-complete, payouts, outbox
retention). No HTTP server.
Read the root `CLAUDE.md` first. Depends only on `@repo/db`, `@repo/core`, `@repo/payments`,
`@repo/i18n` — never on `server/` or `apps/*`; it talks to the API only through the DB.

## Layout

| Path                                | What                                                                                                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                       | Entry: env → logger → Redis ping → mailer + providers → job scheduler + dispatcher loop; SIGTERM/SIGINT stop                                                                                                                                                         |
| `src/run-job.ts`                    | One-off job run without Redis: `node dist/run-job.js <job-name>` (E2E, operators)                                                                                                                                                                                    |
| `src/env.ts`                        | Zod env (`parseEnv`); invalid → one error listing every key, exit 1                                                                                                                                                                                                  |
| `src/logger.ts`                     | pino JSON logger + `describeError` (one line, emails replaced by `[email]`, ≤ 1000 chars)                                                                                                                                                                            |
| `src/redis.ts`                      | ioredis connection for BullMQ (`maxRetriesPerRequest: null`), pinged at boot                                                                                                                                                                                         |
| `src/outbox/dispatcher.ts`          | `OutboxDispatcher` (claim / process / backoff / dead-letter), `DEAD_LETTER_AT`                                                                                                                                                                                       |
| `src/outbox/handler.ts`             | `defineHandler(schema, fn, { secretKeys? })`, `HandlerContext { tx, log, event }`                                                                                                                                                                                    |
| `src/outbox/errors.ts`              | `PermanentError` — dead-letter now, no retry                                                                                                                                                                                                                         |
| `src/handlers/index.ts`             | `createHandlers(deps)` — the handler table = the event types this worker claims                                                                                                                                                                                      |
| `src/handlers/payment-requested.ts` | `payment.requested` → `PaymentProvider.createSession`, or the zero-amount confirmation                                                                                                                                                                               |
| `src/handlers/refund-requested.ts`  | `refund.requested` → `PaymentProvider.refund`, Refund / Payment outcome                                                                                                                                                                                              |
| `src/handlers/notifications.ts`     | email handlers                                                                                                                                                                                                                                                       |
| `src/domain/`                       | Mirrors of the API's order writers (no `server/` import): `lockOrder`, `commitStock`, ledger groups, `confirmZeroAmountPayment` (also queues Zalo ORDER_PAID). Every `SubOrder.status` write here calls `@repo/db` `queueZaloStatusMessages` in the same transaction |
| `src/jobs/`                         | Scheduled jobs (`index.ts` `JOB_NAMES` / `createJobs`), `run.ts` keyset walker, `scheduler.ts` BullMQ `JobScheduler`                                                                                                                                                 |
| `src/email/mailer.ts`               | `Mailer` interface + nodemailer SMTP implementation                                                                                                                                                                                                                  |
| `src/email/templates.ts`            | Pure renderers → `{ subject, text, html }`, all text from `@repo/i18n` `email.*`                                                                                                                                                                                     |
| `src/payments/providers.ts`         | Builds VNPay / Stripe from env; missing credentials → provider absent (disabled)                                                                                                                                                                                     |
| `src/payments/provider-errors.ts`   | `PERMANENT_PROVIDER_ERRORS` — adapter error codes that dead-letter (session + refund handlers)                                                                                                                                                                       |

## Outbox dispatcher — semantics

**Design choice:** handlers run **in-process from the dispatcher**, one DB transaction per event —
not "poll → enqueue BullMQ job → mark processed". Reason: the outbox row already has `attempts`,
`last_error` and `next_attempt_at`, so retry state lives next to the event; a handler's DB writes
commit atomically with the "processed" mark (exactly-once for DB effects); and there is no second
queue whose state can diverge from the table. BullMQ is used only for the repeatable jobs
("Scheduled jobs" below).

1. **Claim** (single autocommit `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`):
   `processed_at IS NULL AND next_attempt_at <= now AND event_type = ANY(<registered types>)`,
   oldest `created_at` first, `LIMIT OUTBOX_BATCH_SIZE`; sets `attempts = attempts + 1` and
   `next_attempt_at = now + lease (5 min)`. Other dispatchers skip locked rows and no longer see
   claimed ones as due.
2. **Process** each claimed event (`OUTBOX_CONCURRENCY` in parallel) in its own interactive
   transaction (timeout 60 s): `SELECT … WHERE id = ? AND processed_at IS NULL AND attempts =
<claimed> FOR UPDATE SKIP LOCKED` — no row means another dispatcher re-claimed it after the
   lease expired, so skip. The row lock is held while the handler runs, so **two dispatchers never
   handle the same event concurrently**. The handler runs inside `SAVEPOINT`; success →
   `processed_at = now` in the same transaction.
3. **Failure** → `ROLLBACK TO SAVEPOINT` (handler writes discarded), `last_error` (scrubbed),
   `next_attempt_at = now + backoff(attempt)` — 5 s, 10 s, 20 s, … capped at 1 h.
4. **Dead-letter** after attempt 10, or at once for a `PermanentError` (invalid payload, provider
   refused, provider not configured, referenced row missing): `processed_at` stays NULL,
   `next_attempt_at = 9999-12-31` (`DEAD_LETTER_AT`; not `infinity` so Prisma can read it),
   logged at `error`. Find them: `SELECT id, event_type, attempts, last_error FROM outbox_events
WHERE processed_at IS NULL AND next_attempt_at = '9999-12-31'`. Requeue: `UPDATE outbox_events
SET attempts = 0, next_attempt_at = now() AT TIME ZONE 'UTC' WHERE id = '…'`.
5. **Crash / transaction timeout** mid-handler: nothing but `last_error = 'transaction failed: …'`
   is recorded (best effort), the claim's lease delays the retry by 5 min and the attempt still
   counts — so a poison event that kills the process is dead-lettered too (a claimed `attempts`
   above the max is dead-lettered without running).
6. **Event types without a handler are never touched.** This is the platform's single outbox
   worker; other modules (live-shopping `live_session.*`, CRM `crm.campaign.scheduled`, CRM
   consumers of `sub-order.delivered` / `.completed`) will fold their handlers in here. Until a
   type is registered, its rows keep `attempts = 0`, `processed_at` NULL and their
   `next_attempt_at`, and they cannot starve a batch (the claim filters by type). The handler
   table (`createHandlers`) is the single source of the claimed types. A payload that fails its
   schema for a **registered** type is dead-lettered.
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
burns attempts. External calls must finish well inside the 60 s transaction: the Stripe client is
built with a 15 s timeout and 1 network retry (`src/payments/providers.ts`); VNPay
`createSession` is local signing; SMTP has 10/10/20 s connection/greeting/socket timeouts.

**Time:** the columns are `timestamp(3)` without time zone holding UTC (what Prisma writes), so
every SQL "now" in the dispatcher is `now() AT TIME ZONE 'UTC'` — correct whatever the session
`TimeZone` is. Due-ness uses the DB clock while the API's Prisma client fills
`next_attempt_at @default(now())` from its own clock; app/DB skew only delays events by that skew.

## Handlers (`OUTBOX_EVENT_SCHEMAS` in `@repo/core/schemas/outbox`)

| Event                                                                                                 | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment.requested {orderId, paymentId, provider, attemptNo}`                                         | Load Payment (row's provider is authoritative). Not PENDING or already has `redirectUrl` → no-op. **Amount 0** (free order; providers reject 0) → zero-amount confirmation, see below. Provider not configured → dead-letter. Else `createSession({ amount, returnUrl, ipAddr: clientIp ?? '127.0.0.1', locale: customer primaryLocale, description: i18n })` then `UPDATE payments SET redirect_url, expires_at, provider_ref WHERE id AND status = 'PENDING'` (0 rows = attempt failed meanwhile → session discarded). `payment.error.provider-unavailable` / unknown errors → retry; `common.error.validation-failed`, `money.error.currency-mismatch`, `money.error.invalid-operand`, `payment.error.amount-mismatch` → dead-letter. VNPay return URL `${API_PUBLIC_URL}/v1/payments/return/vnpay`; Stripe `${WEB_ORIGIN}/{locale}/order/success?orderId=`. |
| `order.created`                                                                                       | Customer email "order received" + total + payment deadline; skipped if the order is no longer AWAITING_PAYMENT                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `order.paid`, `order.cancelled` (reason)                                                              | Customer email                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `refund.requested {refundId, orderId, subOrderId}`                                                    | Provider refund — see "Refund handler" below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sub-order.shipped {orderId, subOrderId, customerId}`                                                 | Customer email: vendor name, carrier + tracking number                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `sub-order.delivered {orderId, subOrderId, customerId}`                                               | Customer email: vendor marked it delivered — confirm receipt on the order page, or contact us before it auto-completes. CRM consumers of this event must fold into this handler (one handler per type)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `payout.released {subOrderId, vendorId}`                                                              | Vendor owner email with the amount credited = the payout's `VENDOR_WALLET` / `PAYOUT_OUT` ledger entry of that sub-order (no entry, i.e. net 0 → email skipped)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `vendor.application.approved {applicationId, vendorId, userId}` / `.rejected {applicationId, userId}` | Applicant email (+ `rejectReason`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `vendor.invitation.created {invitationId, vendorId, email, token}`                                    | Email to the invitation's address with `ADMIN_ORIGIN/invite?token=`. Token must hash to the stored `token_hash` (else dead-letter); revoked / accepted / expired → skipped. Declared `secretKeys: ['token']`: the dispatcher strips `token` from the stored payload when the event is processed **or** dead-lettered (kept only while retries need it). Never log payloads. Invitee locale = matching user's, else `vi`.                                                                                                                                                                                                                                                                                                                                                                                                                                        |

- **Not handled** (rows wait untouched, see dispatcher rule 6): `sub-order.completed` (emitted by
  the API and by `auto-complete-sub-orders`; CRM will consume it). Registering a handler means this
  dispatcher claims the type — add one only together with its consumer. Until then these rows stay
  unprocessed, so `outbox-retention` never deletes them: one row per completed sub-order
  accumulates (ids only) until the CRM handler ships and processes the backlog.
- **Zero-amount confirmation** (`src/domain/zero-amount.ts`, mirror of the API's
  `confirmZeroAmount` → `markOrderPaid`, server CLAUDE.md "Payments → Zero amount"), inside the
  event's `ctx.tx`: lock the order row, then the payment row; only a PENDING payment of 0 on an
  AWAITING_PAYMENT order (else nothing written); payment CONFIRMED, `providerTxnId` = paymentId,
  `rawPayload {zeroAmount: true}`; if every sub-order is AWAITING_PAYMENT: other PENDING attempts
  → FAILED, sub-orders → PAID (count must match), stock `on_hand -= qty, reserved -= qty` in
  variant-id order (guard failure → clamp at 0 + error log), escrow IN only for `paid_i > 0`
  (none for a consistent free order), `orders.status = deriveOrderStatus` (PAID), outbox
  `order.paid`. A sub-order not AWAITING_PAYMENT → payment CONFIRMED + error log (manual review),
  as the API.
- **Refund handler** (`src/handlers/refund-requested.ts`, contract in server CLAUDE.md "Refunds"):
  Refund not PENDING, or PENDING with a `providerRefundId` (provider said PENDING earlier) →
  no-op. Payment without `providerTxnId` or provider not configured → dead-letter. Calls
  `provider.refund({ refundId (idempotency id), paymentId, providerTxnId, providerRef, amount =
Refund.amount, paymentAmount = Payment.amount, reason, initiatedBy = requestedById })` before
  taking any lock. **SUCCEEDED** → lock the order row, Refund SUCCEEDED + `providerRefundId`
  `WHERE status = 'PENDING'`; Payment CONFIRMED → REFUNDED only when every sub-order of the order
  is REFUNDED or CANCELLED (late-payment refunds) and Σ SUCCEEDED refunds of the payment ≥ its
  amount (the order lock lets parallel sibling refunds see each other). **FAILED** → Refund FAILED
  (+ `providerRefundId`), `error` log = ops alert; ledger and sub-order untouched (the API already
  moved the money to `CUSTOMER`; a retry is a new Refund row + event). **PENDING** (async at the
  provider) → stays PENDING with `providerRefundId`, `warn` log; PENDING **without** a provider
  reference (VNPay code 94 = duplicate request id, e.g. a redelivery after the first call's commit
  was lost — the money may already be back) → stays PENDING, `error` log "possible duplicate
  request". **Reconciliation is manual for now** (no VNPay `querydr` / Stripe `refund.updated`
  yet): check the provider, then set the Refund SUCCEEDED / FAILED by hand.
  `payment.error.provider-unavailable` / unknown → retry; `common.error.validation-failed`,
  `money.error.*`, `payment.error.amount-mismatch` → dead-letter. **A dead-lettered refund keeps
  the Refund PENDING**, which blocks a new Refund for that sub-order (partial unique index) and its
  payout: fix the cause (e.g. configure the provider) and requeue the outbox row (dispatcher rule
  4), or, if the provider can never do it (no `providerTxnId`), refund outside the platform and set
  the Refund FAILED/SUCCEEDED by hand.
- **Email:** recipient = `User.email` re-read from the DB, locale = `User.primaryLocale`. A user
  without email (Facebook-only sign-in) → skipped, event processed, logged at info with the user id.
  Templates: subject + text + simple HTML (all interpolated text HTML-escaped), money via
  `formatMoney`, dates via `formatDateTime` (Asia/Ho_Chi_Minh). Order links:
  `${WEB_ORIGIN}/{locale}/order/track?orderId=`; vendor links: `ADMIN_ORIGIN`.
- **PII:** log ids only. `describeError` replaces email addresses in `last_error` / logs (SMTP
  rejections echo the recipient). pino `redact` covers `email` / `to` / `redirectUrl` as a net.

## Adding a handler (e.g. `live_session.*`, `crm.campaign.scheduled`, CRM consumers)

1. Payload schema (ids only, unless a secret is unavoidable) in `@repo/core/schemas/outbox` and its
   entry in `OUTBOX_EVENT_SCHEMAS`. The emitter (API) writes the row in its business transaction.
   Until step 3 ships, those rows simply wait — this worker never claims a type it cannot handle.
2. A module under `src/handlers/` (one file per domain, e.g. `live-session.ts`, `crm.ts`) exporting
   `xxxHandlers(deps)` that returns `{ 'event.type': defineHandler(OUTBOX_EVENT_SCHEMAS['event.type'],
async (payload, ctx) => { … }) }`. Rules: re-read state through `ctx.tx` and write through it
   (atomic with the "processed" mark); be idempotent (redelivery happens); throw `PermanentError`
   for input a retry cannot fix, anything else is retried with backoff; external calls need their
   own timeout well under 60 s; log ids only. Secrets in the payload → `defineHandler(schema, fn,
{ secretKeys: ['token'] })` so they are stripped when the event is done.
3. Spread it into `createHandlers` (`src/handlers/index.ts`) — that table is the list of claimed
   event types — and extend `HandlerDeps` / `main.ts` wiring and `src/env.ts` for new config.
4. Tests in `test/` with `insertEvent(type, payload)` + `dispatcher.pollOnce()` (see the existing
   files), then update the Handlers table above.

## Scheduled jobs (`src/jobs/`, T3.2)

`JobScheduler` (`scheduler.ts`): one BullMQ queue `scheduled-jobs` on the `connectRedis()`
connection, one `upsertJobScheduler(<job name>, { every })` per job — the fixed scheduler id means
every worker machine upserts the same schedule (no duplicates) and each produced job goes to one
worker (BullMQ job lock). Worker `concurrency: 1`; started in `main.ts` before the dispatcher loop,
`close()` (called on SIGTERM in parallel with the dispatcher drain) aborts the running job's
`AbortSignal` — it stops after its current row — and waits for it. A failed run is logged
(`scheduled job failed`) and
simply runs again at the next interval; completed/failed job records are capped (100 / 500).
Across machines a slow run may overlap the next one — every job is safe under concurrency (order
row lock first + re-check under the lock + conditional `UPDATE … WHERE <from state>`), proven by
tests that run jobs twice in parallel.

Every job walks due rows by keyset pages of `JOB_BATCH_SIZE` (`run.ts` `forEachCandidate`), **one
transaction per row** (15 s timeout); a row that throws is logged and retried next run; a run
visits each row once, so it always ends. All "now" comparisons use the DB clock
(`now() AT TIME ZONE 'UTC'`, like the dispatcher); timestamps written by jobs use the DB clock
read under the order lock. Tunables come from `PlatformSettings` (oldest row, like the API),
re-read each run; no settings row → the run fails.

| Job (scheduler id)         | Default every | Selects                                                                                                                 | Per row (after locking the ORDER row first)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expire-unpaid-orders`     | 1 min         | orders AWAITING_PAYMENT with `payment_deadline_at < now`                                                                | The API's `cancelOrder` contract with reason `PAYMENT_EXPIRED` (server `order-cancellation.ts`): re-check AWAITING_PAYMENT + overdue + every sub-order AWAITING_PAYMENT (else skip, nothing written); sub-orders CANCELLED + `cancelledAt` `WHERE status = 'AWAITING_PAYMENT'` (count mismatch → rollback); release `stock_reserved` in variant-id order (clamped at 0); delete CouponRedemptions; PENDING payments → FAILED; `deriveOrderStatus`; outbox `order.cancelled`; Zalo ORDER_CANCELLED messages (`queueZaloStatusMessages` from `@repo/db`, roadmap D16). A payment confirmed later goes to the API's late-payment refund path.                              |
| `auto-complete-sub-orders` | 1 h           | sub-orders DELIVERED with `delivered_at + refundWindowDays <= now`                                                      | Mirror of `transitionSubOrder(…, COMPLETED, SYSTEM)`: re-check status + window, `assertTransition('DELIVERED','COMPLETED','SYSTEM')`, `UPDATE … WHERE status = 'DELIVERED'` + `completedAt`, `deriveOrderStatus`, outbox `sub-order.completed {orderId, subOrderId, vendorId}` (not handled here — waits for CRM), Zalo ORDER_COMPLETED (+ AFTER_DELIVERY) messages (`queueZaloStatusMessages`).                                                                                                                                                                                                                                                                        |
| `release-payouts`          | 1 h           | sub-orders COMPLETED, `payout_released_at IS NULL`, `completed_at + holdPeriodDays <= now`, no Refund PENDING/SUCCEEDED | Re-check all of it under the lock (a concurrent run → skip); wallet must exist in the sub-order currency (else skip + `error` log, every run, until fixed by hand); `payoutReleasedAt = now` `WHERE … IS NULL AND status = 'COMPLETED'`; one ledger group `PAYOUT_OUT` from `computePayoutPostings` (`subOrderPaid` / `subOrderNet` from `@repo/core`): `PLATFORM_ESCROW −paid`, `VENDOR_WALLET +net` (with `vendorId`), `PLATFORM_REVENUE +(commission − platformDiscount)` (may be negative), zero postings dropped, `assertZeroSum`; `UPDATE wallets SET balance_amount = balance_amount + net` (currency-guarded); outbox `payout.released {subOrderId, vendorId}`. |
| `outbox-retention`         | 1 day         | —                                                                                                                       | `DELETE` processed outbox rows with `processed_at < now − OUTBOX_RETENTION_DAYS` in batches of `JOB_BATCH_SIZE`. Unprocessed rows (pending, retrying, dead-lettered — `processed_at` NULL) are never deleted.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Driving time (E2E / ops):** there is no fake clock — move the data instead: back-date
`orders.payment_deadline_at`, `sub_orders.delivered_at` / `completed_at` (UTC, e.g. `now() AT TIME
ZONE 'UTC' - interval '8 days'`), or lower `platform_settings.hold_period_days` /
`refund_window_days` (0 = due at once). Then run the job on demand: `pnpm --filter @workers/jobs
run-job <job-name>` (`node dist/run-job.js <job-name>`: runs once against `DATABASE_URL`, no Redis
or BullMQ, exit 1 if a row failed; safe next to the scheduled worker), or set
`JOB_*_EVERY_MS=1000` on the worker. Each run logs a summary `{candidates, done, skipped, failed}`.

## Env

`DATABASE_URL`, `REDIS_URL` (required); `WEB_ORIGIN`, `ADMIN_ORIGIN`, `API_PUBLIC_URL`; `SMTP_HOST`
(localhost), `SMTP_PORT` (1025; 465 = implicit TLS), `SMTP_USER` + `SMTP_PASS` (optional, together),
`SMTP_FROM`; `VNPAY_TMN_CODE` + `VNPAY_HASH_SECRET` + `VNPAY_PAY_URL` + `VNPAY_API_URL` (all four →
VNPay enabled); `STRIPE_SECRET_KEY` (→ Stripe enabled; `STRIPE_WEBHOOK_SECRET` optional, unused here);
`OUTBOX_POLL_INTERVAL_MS` (1000), `OUTBOX_BATCH_SIZE` (50), `OUTBOX_CONCURRENCY` (2), `LOG_LEVEL`,
`NODE_ENV`; scheduled jobs: `JOB_EXPIRE_UNPAID_ORDERS_EVERY_MS` (60000),
`JOB_AUTO_COMPLETE_SUB_ORDERS_EVERY_MS` (3600000), `JOB_RELEASE_PAYOUTS_EVERY_MS` (3600000),
`JOB_OUTBOX_RETENTION_EVERY_MS` (86400000), all ≥ 1000; `JOB_BATCH_SIZE` (100),
`OUTBOX_RETENTION_DAYS` (30). A disabled provider does not stop the worker: its
`payment.requested` / `refund.requested` events dead-letter with `payment provider X is not
configured`. The worker does not read `.env`: use Doppler or export.

## Deploy

Separate Fly app `elma-worker-{dev,prod}` (`fly.toml`: no `[http_service]`, `kill_timeout 90s`),
image from `Dockerfile` (Node 22, build context = repo root, `Dockerfile.dockerignore` beside it;
keeps the pnpm layout so workspace symlinks + the generated Prisma client resolve).
`.github/workflows/deploy-worker.yml` deploys on push to `dev` / `prod`. One machine is enough;
more are safe (claims skip locked rows). Migrations are not run by the worker.

## Commands

```bash
pnpm --filter @workers/jobs dev        # tsup --watch + restart (needs DATABASE_URL, REDIS_URL; Mailhog for SMTP)
pnpm --filter @workers/jobs build      # tsup → dist/main.js + dist/run-job.js (ESM)
pnpm --filter @workers/jobs start      # node dist/main.js
pnpm --filter @workers/jobs run-job release-payouts   # one job once, no Redis (needs DATABASE_URL, REDIS_URL set)
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
zero-amount confirmation (+ cancelled order untouched), refund handler (success, sibling refunds
in parallel → Payment REFUNDED, partial keeps CONFIRMED, FAILED, provider PENDING, idempotent
redelivery, retry, dead-letter), email rendering vi + en (payout amount from the ledger),
null-email skip, invitation token scrub; jobs (`test/jobs.test.ts`): expiry = cancel contract
(stock, redemptions, payments, outbox) + concurrent runs cancel once, auto-complete + boundary
(−1 s not due, +1 ms due; timestamp(3) rounding), aborted run stops, payout ledger/wallet/outbox, hold boundary ±1 s, concurrent + repeated runs pay once,
refund blocks payout, wallet currency mismatch skipped, books balance (groups sum to 0, wallet =
Σ VENDOR_WALLET), retention keeps dead letters; `test/scheduler.test.ts` starts a Redis 7
container: one fixed schedule per job even with two schedulers, every job runs. Boundaries use
one transaction (where `now()` is fixed) instead of sleeps: `support/market.ts` `setSubOrderTime`
sets timestamps relative to the DB clock.
