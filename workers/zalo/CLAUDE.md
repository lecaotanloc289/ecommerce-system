# @workers/zalo

Holds each shop's personal Zalo session and sends its automated order messages. Uses
[zca-js](https://github.com/RFS-ADRENO/zca-js) — an **unofficial** reverse-engineered Zalo web API (QR
login, cookies). Read the root `CLAUDE.md` first; the HTTP side (QR request, templates, message log, the
`queueZaloMessages` helper) is in `server/CLAUDE.md` "Zalo notifications"; shared shapes in
`@repo/core` `schemas/zalo.ts`.

Depends on `@repo/core`, `@repo/db` (the `prisma` singleton, used directly — no Nest here), `@repo/i18n`
(money formatting). Never imports `server/` or `apps/*`.

> **Risk:** zca-js is not an official Zalo API. Zalo can change it without notice or lock an account
> that messages many strangers. Mitigations here: customers opt in at checkout (`Order.zaloOptIn`),
> one call per account every `ZALO_SEND_MIN_INTERVAL_MS`, recipient lookups cached, no listener.
> The official route (Zalo OA + ZNS templates) would need a different adapter behind `ZaloGateway`.

## Layout

| Path                 | What                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`        | Entry: parse env, start, `SIGINT`/`SIGTERM` → graceful stop (releases leases)                                             |
| `src/app.ts`         | Wiring: Redis (+ a blocking connection), loops (account sync, send), QR login processor                                   |
| `src/env.ts`         | Zod env (`parseEnv`)                                                                                                      |
| `src/gateway.ts`     | `ZaloGateway` / `ZaloSession` port, `QrLoginEndedError`, `ZaloRejectedError` (Zalo answered with an error), `withTimeout` |
| `src/zca-gateway.ts` | zca-js adapter (`loginQR`, `login(credentials)`, `findUser`, `sendMessage`, `keepAlive`)                                  |
| `src/credentials.ts` | `ZaloCredentials` schema + `CredentialsCipher` (AES-256-GCM, `v1.<iv>.<tag>.<data>`, vendor id as AAD)                    |
| `src/accounts.ts`    | `AccountManager`: Redis leases, session restore, keep-alive, `connect` after a QR login                                   |
| `src/messages.ts`    | `MessageSender`: claim → render → recipient lookup → send → SENT/SKIPPED/retry/FAILED; housekeeping                       |
| `src/logins.ts`      | `QrLoginProcessor`: BRPOP login ids, drive the QR flow, write the Redis login state                                       |

## How it works

**Session holding (`AccountManager`, every `ZALO_ACCOUNT_SYNC_INTERVAL_MS`).** Each ACTIVE
`zalo_accounts` row is logged in on exactly one replica: the one holding Redis lease
`zalo:lease:{accountId}` (value = instance id, TTL 3 × sync interval, renewed by a compare-and-pexpire
Lua). Lease TTL = 2 × (sync interval + `ZALO_CALL_TIMEOUT_MS`). Per sync: first renew every held lease
and drop held sessions whose row is no longer ACTIVE or whose stored credentials changed (re-linked by a
QR login on another replica), or whose lease was lost; then, **concurrently** and each capped at
`ZALO_CALL_TIMEOUT_MS` (so one hung zca-js call can't starve the next renewal): `SET NX` the lease of
every unheld ACTIVE row and restore it with `gateway.login(decrypt(credentials))`, and run due
keep-alives (zca-js `keepAlive` + `fetchAccountInfo`, every `ZALO_KEEPALIVE_INTERVAL_MS`; success
updates `lastSeenAt` and re-encrypts rotated cookies). Failures back off 1, 2, 4… min. **Only
`ZaloRejectedError` (Zalo answered with an error) counts towards EXPIRED** —
`ZALO_MAX_SESSION_FAILURES` consecutive rejections, or immediately when the ciphertext cannot be
decrypted (key rotated / copied from another vendor's row). Network errors and timeouts retry forever,
so an outage never forces shops to re-scan; their messages wait (max age below). Every write to the row is guarded on the ciphertext the replica holds, so an old session can
never overwrite a newer login. The shop re-scans the QR to recover an EXPIRED account.

**QR login (`QrLoginProcessor`).** Redis contract (core `schemas/zalo.ts`): the API writes
`zalo:login:{loginId}` = `ZaloLoginRecord` (`{ vendorId, requestedById, state: PENDING }`, TTL 600 s) and
`LPUSH`es the id onto `zalo:login:queue`. Any replica `BRPOP`s (≤ `ZALO_MAX_CONCURRENT_LOGINS` at once),
skips ids that are malformed / expired / no longer PENDING, runs zca-js `loginQR` and writes the state
with `SET … KEEPTTL XX` (never resurrects an expired key): `QR_READY` (PNG data URL) → `SCANNED` →
`SUCCESS`, or `EXPIRED` (zca-js expires the QR after 100 s), `DECLINED`, `FAILED` (`login-failed`;
`already-linked` when that Zalo uid belongs to another shop — `zalo_accounts.zalo_uid` is unique). On
success `AccountManager.connect` upserts the row (ACTIVE, encrypted credentials, profile), force-takes the
lease and holds the session. zca-js quirk: on expiry/decline it waits for `retry()`/`abort()` forever,
so the adapter always calls `abort()`; a whole flow is capped by `ZALO_QR_LOGIN_TIMEOUT_MS`.

**Sending (`MessageSender`, every `ZALO_POLL_INTERVAL_MS`).** Rows are written by the API in the order
transaction (`zalo_messages`, one per sub-order + event, PENDING, `scheduledAt`). Housekeeping (any
replica): SENDING rows whose `lockedUntil` passed → PENDING (crash recovery); PENDING rows of a
DISCONNECTED shop, or older than `ZALO_MESSAGE_MAX_AGE_HOURS` past `scheduledAt` (session expired and not
re-scanned in time) → SKIPPED `account-unavailable`. Then, for each held account that is idle and past its
pacing time: claim its oldest due row (`UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)` → SENDING,
`lockedUntil` = now + 120 s; DB clock in UTC to match Prisma's `timestamp(3)`). The returned
`lockedUntil` is the **claim token**: every later write is guarded `WHERE status = 'SENDING' AND
locked_until = token`, so a late finisher can't touch a row that was reclaimed and claimed again. Then:

1. Vendor not ACTIVE → SKIPPED `vendor-inactive`. Template `(vendorId, event)` missing or disabled → SKIPPED `template-disabled`.
2. AFTER_DELIVERY while the sub-order is no longer DELIVERED/COMPLETED, or any event other than
   ORDER_CANCELLED / ORDER_REFUNDED while the sub-order is CANCELLED / REFUNDED (a late "paid / shipped"
   message) → SKIPPED `order-status-changed`.
3. Shipping-address snapshot phone not a VN mobile (`normalizeVnPhone` → `0xxxxxxxxx`) → SKIPPED `invalid-phone`.
4. Recipient uid via `findUser(phone)`, cached in `zalo:recipient:{accountId}:{phone}` (30 days; a miss is
   cached as `''` for 1 day) → none → SKIPPED `recipient-not-found`.
5. Render (core `renderZaloTemplate`): `customerName` (snapshot recipient), `orderCode` (`#` + last 8 of
   the order id), `shopName`, `total` (subtotal + shipping − vendor − platform discount, `formatMoney` in
   the customer's `primaryLocale`), `itemList` (`• title xqty` lines), `carrier`, `trackingNumber`.
6. Re-check the lease (`GET`): taken over meanwhile → row back to PENDING, no attempt spent.
7. `sendMessage` → SENT (`renderedBody`, `zaloMessageId`, `sentAt`). Lookup/send error or timeout
   (`ZALO_CALL_TIMEOUT_MS`) → `attempts + 1`, PENDING with `nextAttemptAt` = now + 1, 2, 4… min (cap 60);
   at `ZALO_MAX_SEND_ATTEMPTS` → FAILED with `lastError` (name + message only).

The final SENT/SKIPPED write is outside the send's error handling (a DB error after a successful send
is not a send failure) and is retried 3×. Delivery is **at-least-once**: a crash — or a timed-out send
that Zalo actually delivered — re-sends once the lock expires / on retry. After any Zalo call
the account waits `ZALO_SEND_MIN_INTERVAL_MS` before the next one.

**Scaling.** Any number of replicas: leases split accounts between them, a replica only claims messages of
accounts it holds, and the claim uses `SKIP LOCKED`. A graceful stop releases its leases so another
replica restores those sessions on its next sync; a crash leaves them until the lease TTL (3 syncs).
Sessions are logged in again on every restore — avoid restart loops (Zalo notices frequent new logins).

## Env

| Var                             | Default                | Notes                                                                          |
| ------------------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`, `REDIS_URL`     | — (required)           |                                                                                |
| `ZALO_CREDENTIALS_KEY`          | — (required)           | 32 bytes base64 (`openssl rand -base64 32`); rotating it expires every account |
| `NODE_ENV` / `LOG_LEVEL`        | `development` / `info` | pino; errors are logged as name + message only (never raw zca-js errors)       |
| `ZALO_POLL_INTERVAL_MS`         | `1000`                 | send loop                                                                      |
| `ZALO_ACCOUNT_SYNC_INTERVAL_MS` | `10000`                | lease renewal / restore / drop; lease TTL = 3×                                 |
| `ZALO_KEEPALIVE_INTERVAL_MS`    | `300000`               | per account                                                                    |
| `ZALO_SEND_MIN_INTERVAL_MS`     | `3000`                 | pacing per account (lookups + sends)                                           |
| `ZALO_MESSAGE_MAX_AGE_HOURS`    | `24`                   | PENDING past this → SKIPPED `account-unavailable`                              |
| `ZALO_MAX_SEND_ATTEMPTS`        | `5`                    | then FAILED                                                                    |
| `ZALO_MAX_SESSION_FAILURES`     | `3`                    | consecutive restore / keep-alive **rejections by Zalo** → EXPIRED              |
| `ZALO_CALL_TIMEOUT_MS`          | `20000`                | hard cap per Zalo call (max 60000; keep well under the 120 s send lock)        |
| `ZALO_MAX_CONCURRENT_LOGINS`    | `5`                    | QR flows per replica                                                           |
| `ZALO_QR_LOGIN_TIMEOUT_MS`      | `180000`               | hard cap per QR flow                                                           |

Empty strings count as unset; an invalid env aborts startup listing every bad key. Like the server, the
worker does not read `.env` itself (Doppler or your shell).

## Run

```bash
doppler run -- pnpm --filter @workers/zalo dev   # tsx watch
pnpm --filter @workers/zalo build                # tsup → dist/main.js
pnpm --filter @workers/zalo start
pnpm --filter @workers/zalo typecheck            # src + test
pnpm --filter @workers/zalo lint
pnpm --filter @workers/zalo test                 # Vitest, needs Docker
```

`tsconfig.json` maps `zca-js` types to `node_modules/zca-js/dist/index.d.ts`: the package's root
`index.d.ts` is `export * from "./dist"` (a directory import NodeNext cannot resolve). Runtime resolution
is unaffected (package `exports`).

## Tests

`test/global-setup.ts` starts throwaway `postgres:16-alpine` + `redis:7-alpine` with the Docker CLI on
random ports and runs `prisma migrate deploy`; `test/setup-env.ts` sets `DATABASE_URL`/`REDIS_URL` before
`@repo/db` is imported. `test/fake-gateway.ts` replaces zca-js. Files: `unit.test.ts` (cipher round trip /
wrong key / other vendor / tamper, phone normalisation, env), `accounts.test.ts` (restore + lease, one holder across two
replicas, disconnect drop, restore rejections → EXPIRED, undecryptable → EXPIRED, cookie rotation persisted,
keep-alive rejections → EXPIRED, network failures never expire, connect takes over the lease, already-linked), `messages.test.ts` (full
render + send, pacing, skips without Zalo calls, recipient miss cached, retry backoff → FAILED, care delay,
suspended shop / cancelled order guards, lease lost before send, send timeout, housekeeping), `logins.test.ts` (SUCCESS with encrypted row + KEEPTTL, expired / declined / aborted,
already-linked, ignored requests, queue loop). The zca-js adapter itself has no automated test (it needs
Zalo); it was smoke-tested by generating a real QR and aborting.

## Known limits

- One Zalo account per shop; staff cannot use their own numbers.
- Text messages only (no images / product cards); templates are a single language (vendor-authored).
- A customer must be findable by phone on Zalo (their privacy setting may block it → `recipient-not-found`).
- Recipient lookups are cached per shop account; a customer who joins Zalo later is found after ≤ 1 day.
- No "message replies" inbox — the worker never starts the zca-js listener.
- Send errors are not classified: a dead session is retried like any error until keep-alive expires it.
- `BRPOP` removes the login id before the work: a crash mid-login leaves the record PENDING until its TTL.
- A vendor can queue many QR logins (only the strict per-IP rate limit caps it); no retention job for
  `zalo_messages` yet (SKIPPED rows accumulate for shops without templates).
