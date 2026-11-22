# server — API (`@server/api`)

Backend HTTP API. NestJS 11 + Fastify, versioned `/v1`, OpenAPI exposed. Serves all roles via REST; webhooks (payment, OAuth callback) terminate here. Code in `server/src/`.
Read the root `CLAUDE.md` first — it is the constitution (Golden Rules, NEVER DO, naming, data flow, domain model, migration, testing). This file holds only API-specific context.

Future async workers (outbox dispatcher, payout cron, email sender) live **OUTSIDE** this workspace — a sibling top-level dir like `workers/<name>/` if/when added.

## Tech stack

- NestJS 11 + Fastify adapter, prefix `/v1`
- `nestjs-zod` pipe (validation from schemas in `@repo/core`; global `ZodValidationPipe`, failures → 422)
- Auth: `@nestjs/passport` 11 + `passport-google-oauth20` + `passport-facebook` + `@nestjs/jwt` 11 (v12 of both is ESM-only / Nest 12 — stay on 11 while the server is CJS on Nest 11)
- Redis: `ioredis` 5 (`RedisModule`, token `REDIS`) — refresh-token sessions, idempotency records, rate-limit counters; BullMQ later
- Errors: global `DomainErrorFilter` — every error leaves as `{ errorCode, params }` (`@repo/core` `DomainError` / `ERROR_CODES`)
- Logger: `nestjs-pino`
- Security: `@fastify/helmet`, `@fastify/cors` (credentials true), `@fastify/cookie`
- OpenAPI: `@nestjs/swagger` + `nestjs-zod` (`createZodDto`, `@ZodResponse`, `cleanupOpenApiDoc`) → `packages/sdk/openapi.json` → `@repo/sdk` (see "OpenAPI / SDK" below)
- Queue: BullMQ (Redis) for the outbox worker, payout scheduler, email sender

## Request pipeline

Controllers orchestrate only: middleware (helmet, cors, rate-limit, request-id) → `JwtAuthGuard` → `RolesGuard @Roles(...)` → interceptors (`@Idempotent()`) → `ZodValidationPipe` → controller → service. Business logic lives in services/domain. See root `CLAUDE.md` §4 (Data flow) for the worked checkout example.

## State (as of 2026-11-23)

- Bootstrap: NestJS 11 + Fastify, helmet + cors + cookie + pino + rate limit, `GET /v1/health`, `GET /v1/health/ready` (DB probe via `PrismaService`).
- Config: `src/config/env.ts` — Zod schema parsed at boot (`ConfigModule`, inject `@Inject(ENV) env: Env`); missing/invalid keys abort startup with a list. Env is injected by Doppler (`doppler run -- pnpm --filter @server/api dev`) or your shell — the server does **not** read `.env` itself.
- Auth module (`src/auth/`) — see below.
- Platform infra (`src/common/`): idempotency, rate limit, cursor pagination — see below. Integration test harness in `test/support/`.
- Cart module (`src/cart/`) — see "Cart" below.
- Not started: catalog, checkout, orders, payments, payouts, outbox.

## Idempotency (Golden Rule #3, roadmap D9)

`@Idempotent()` (`src/common/idempotency/idempotent.decorator.ts`) on a mutation handler behind `JwtAuthGuard` — mandatory on `/orders/checkout` and `/payments/*`. `IdempotencyModule` is global (registered in `AppModule`), so feature modules need no import.

- Header `Idempotency-Key` = client ULID (`IdempotencyKeySchema`). Missing or malformed → 400 `idempotency.error.key-required`. No `request.user` → 401 (fails closed; keys are per user).
- Redis key `idem:{userId}:{key}`; fingerprint = sha256(method + concrete URL incl. params/query + canonical JSON body with sorted keys). The body hashed is the JSON-parsed body (interceptors run before pipes).
- First request: `SET NX PX 60s` lock `{state:'processing'}` → handler → on 2xx store `{state:'completed', status, body}` for 24h (Lua compare-and-swap on the lock).
- Same key + same fingerprint while running → 409 `idempotency.error.in-progress`; after success → replay stored status + body with header `idempotent-replayed: true` (handler not called). Different fingerprint → 422 `idempotency.error.key-reused`.
- **Errors are not cached:** any thrown error (4xx `DomainError` included) or non-2xx status releases the lock, so the client can retry the same key.
- **Lock TTL is 60s, not renewed.** A handler running longer loses the lock; a concurrent retry may then execute again, and the late completion is logged (`idempotency lock expired…`) without overwriting. Same if writing the completed record fails (response still returned, logged). So money-moving writes (checkout, payments) **must also** have a DB unique constraint on the key (e.g. `Order.idempotencyKey`) — Redis alone is not the guarantee.
- An unreadable record (corrupt / older format) answers 422 key-reused rather than re-executing.
- Replay restores status + body only (no handler-set headers); handlers must return JSON-serializable values.

## Rate limit

`@fastify/rate-limit` registered by `registerRateLimit(app)` (`src/common/rate-limit.ts`, called in `main.ts` before `listen`), Redis store (keys `rl:*`), per client IP.

- **Client IP:** `clientIp()` takes the address `TRUSTED_PROXY_HOPS` (default 1 = Fly edge) entries into `request.ips` (socket peer first, then X-Forwarded-For from nearest). Entries further left are client-supplied and ignored, so spoofing XFF cannot reset a bucket. Do **not** key on `request.ip`: `trustProxy: true` makes it the leftmost, spoofable XFF entry. Set `0` when nothing proxies the API.
- **Buckets:** every route shares one bucket of `RATE_LIMIT_MAX` (default 100) per `RATE_LIMIT_WINDOW` (default `1m`). Sensitive handlers add `@RateLimit('strict')` (method-level; wraps Fastify `RouteConfig`): `RATE_LIMIT_STRICT_MAX` (default 20) in a bucket per method + route — currently all OAuth start/callback routes, `/auth/refresh`, `/auth/logout`; checkout and payments must add it. `@SkipRateLimit()` exempts a handler (only `/health`, `/health/ready`).
- Over the limit → 429 `common.error.rate-limited` + `retry-after` (the hook throws a `DomainError`, which Nest's Fastify error handler routes through `DomainErrorFilter`).
- **Redis down:** the default bucket fails open (availability); strict routes fail closed (500) — they must not lose brute-force protection.
- **Known limit:** a server-side caller (storefront SSR on Workers) shares its egress IP's bucket across all its users. When SSR starts calling the API, give it an allow-list / trusted-client key instead of raising the global limit.

## Pagination

List endpoints take `PageQuerySchema` (`?cursor=<ulid>&limit=1..100`, default 20) and return `PageSchema(item)` = `{ items, nextCursor }` — both in `@repo/core`. `src/common/pagination.ts`: `cursorPageArgs(query, 'desc' | 'asc')` → `{ take: limit + 1, where: { id: { lt | gt: cursor } }, orderBy: { id } }` (spread `where` into your filter), then `toPage(rows, query)` trims the look-ahead row and sets `nextCursor` (null on the last page). Relies on ULID ids sorting by creation time.

## Auth (Golden Rule #5)

| Endpoint                                      | Guard                        | Behaviour                                                                                                                                                                       |
| --------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/auth/google?app=web\|admin`          | `OAuthStartGuard`            | Sets `oauth_state` cookie (random state + app), 302 → Google                                                                                                                    |
| `GET /v1/auth/google/callback`                | `OAuthCallbackGuard`         | Checks `?state` == cookie (login-CSRF), resolves user, sets refresh cookie, 302 → `AUTH_REDIRECT_URL_WEB\|ADMIN`. Any failure → 302 there with `?error=auth.error.oauth-failed` |
| `GET /v1/auth/facebook`, `/facebook/callback` | same                         | same                                                                                                                                                                            |
| `POST /v1/auth/refresh`                       | cookie                       | Rotates the refresh cookie, returns `{ accessToken, tokenType: 'Bearer', expiresIn }`                                                                                           |
| `POST /v1/auth/logout`                        | cookie                       | Revokes the session (token family), clears cookie, 204 (idempotent)                                                                                                             |
| `GET /v1/auth/me`                             | `JwtAuthGuard`, `RolesGuard` | Current user profile + effective roles + vendorId                                                                                                                               |

- **Frontend flow:** navigate to `/v1/auth/<provider>?app=…` → land on the app's `/auth/callback` → `POST /v1/auth/refresh` (`credentials: 'include'`) → keep the access token in memory; call refresh again on 401 `auth.error.token-expired`.
- **User resolution** (`AuthService.resolveOAuthUser`, one `$transaction`): known identity → login; provider-**verified** email matching a `User` → link new `OAuthIdentity`; else create `User` + `OAuthIdentity` + `UserRole CUSTOMER` (ULIDs). Unverified emails are never linked and never stored on `User.email` (blocks pre-account-takeover). Facebook emails are always treated as unverified (Graph API gives no guarantee) — so a Facebook-only user has `User.email = null` and a later Google login with the same address creates a separate account (accepted trade-off for takeover safety; an explicit "link account" flow is future work). Emails are stored and matched lowercase — keep every writer (seed included) lowercasing.
- **Access JWT** (HS256, `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL` = 15m): `{ sub, roles, vendorId? }` from `UserRole` rows; vendor roles count only while the vendor is `ACTIVE`; `vendorId` = oldest active vendor role. Roles are re-read on every refresh.
- **Refresh JWT** (HS256, `JWT_REFRESH_SECRET`, `JWT_REFRESH_TTL` = 30d): `{ sub, fid, jti }` in cookie `refresh_token` (HttpOnly, Secure, SameSite=Lax, Path=`/v1/auth`). State in Redis, no DB table: `auth:rt:family:<fid>` = `{ userId, current, prev, rotatedAt }` (sha256 hashes), TTL slides on rotation. Rotation is an atomic Lua compare-and-swap. Presenting `prev` within `REFRESH_REUSE_GRACE_MS` (10s) is a benign concurrent refresh (two tabs, SSR + client, StrictMode): it gets an access token but no new cookie, and the family survives (logged at info; the window uses the Redis server clock). Any other non-current token deletes the family (reuse detection → that session is logged out). The DB lookup for the access token runs _before_ the swap, so a DB failure never strands the client with a rotated-away cookie. Limit: if a successful refresh response is _lost in transit_ and the client retries within 10s, it keeps the stale cookie and is logged out at its next refresh — frontends should single-flight refresh calls (one in-flight refresh shared by all callers).
- **Protecting routes:** import `AuthModule`, then `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('VENDOR_OWNER')`; read the caller with `@CurrentUser() user: AuthUser` (`{ id, roles, vendorId? }`). `RolesGuard` fails closed — a guarded route without `@Roles` is 403; use `@Roles(...ALL_ROLES)` for "any signed-in user".
- **Known limits:** access tokens stay valid until expiry (≤ 15m) after logout, family revocation, vendor suspension or role removal (no denylist / per-user session index yet) — services must re-check vendor status/ownership in the DB before destructive vendor or payout actions rather than trusting `req.user.vendorId` alone. The refresh cookie is always `Secure` (Golden Rule #5): Chrome/Firefox accept it on `http://localhost`, Safari may not — use Chrome for local login. SameSite=Lax means the API must be same-site with the web/admin origins in prod (e.g. `api.example.com` + `example.com`), otherwise the refresh cookie isn't sent. `TokenResponse` / `MeResponse` live in `@repo/core/schemas/me`; `src/auth/auth.schemas.ts` keeps only the server-internal schemas (token claims, `AuthUser`, OAuth profile).

## Cart (`src/cart/`)

All routes `@Roles('CUSTOMER')`, scoped to `req.user.id`; shapes in `@repo/core/schemas/cart`. Prices are never stored — every read joins the current variant price. `?locale=vi|en` (default vi) picks the product name/slug (falls back to any translation).

| Endpoint                                   | Behaviour                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/cart`                             | Lines grouped by vendor (oldest line first): `unitPrice`, `lineTotal`, `stockAvailable`, `unavailable` (product not ACTIVE or vendor not ACTIVE). Per-group `subtotals` are per currency over available lines; `hasMixedCurrency` flags a mixed cart. Does not create a Cart row.                                                                                                                     |
| `PUT /v1/cart/items/:variantId {quantity}` | `@Idempotent`. Sets the quantity; `0` removes (also works for unavailable lines). Unknown variant → 404 `product.error.variant-not-found`; product/vendor not ACTIVE → 409 `product.error.not-available`; over stock → 409 `cart.error.quantity-exceeds-stock`.                                                                                                                                       |
| `DELETE /v1/cart/items/:variantId`         | `@Idempotent`. Removes the line; absent line is a no-op. Returns the cart.                                                                                                                                                                                                                                                                                                                            |
| `POST /v1/cart/merge {items[]}`            | `@Idempotent`. Guest-cart merge: quantities add to existing lines (duplicates summed), clamped to `stockAvailable`; a merge never lowers an existing line; unknown/unsellable variants are dropped. Returns `{ cart, adjustments[] }` (`CLAMPED` / `UNAVAILABLE`). Same key replays; a **new key adds the quantities again**, so the client calls merge once after login, then clears the guest cart. |
| `GET /v1/cart/shipping-options`            | Active `ShippingMethod`s per vendor present in the cart (sellable lines only), `{ groups: [{ vendorId, methods }] }`.                                                                                                                                                                                                                                                                                 |

Lazy cart creation is `upsert` on the unique `userId` (race-safe); merge locks the cart row (`SELECT … FOR UPDATE`) in its transaction. Tests: `test/integration/cart.spec.ts`.

## OpenAPI / SDK

- `src/openapi/openapi.ts` — `buildOpenApiDocument(app)` (DocumentBuilder + `cleanupOpenApiDoc`; exports `BEARER_AUTH`, `REFRESH_COOKIE_AUTH` scheme names). Only with `NODE_ENV=development`, `main.ts` serves Swagger UI at `/docs` and the raw spec at `/v1/openapi.json`.
- `pnpm --filter @server/api openapi:export` (`scripts/export-openapi.ts`, run via ts-node with `tsconfig.scripts.json`) builds the real `AppModule` with stubbed `PrismaService` + `REDIS` and a fixed dummy env — no Postgres/Redis needed — and writes `packages/sdk/openapi.json` with sorted keys (deterministic). Root `pnpm sdk:generate` = export + `openapi-typescript` + SDK build; CI fails on drift.
- **Every new route must declare its schemas so it reaches the SDK:** DTO classes via `createZodDto(Schema)`, DTO-typed `@Body/@Query/@Param`, `@ZodResponse({ status, type })` for the response (a global `ZodSerializerInterceptor` parses it), `@ApiTags/@ApiOperation`, `@ApiBearerAuth(BEARER_AUTH)` on guarded routes; then run `pnpm sdk:generate` and commit. Details: `packages/sdk/CLAUDE.md`. Auth DTOs: `src/auth/auth.dto.ts`; health: `src/health/health.dto.ts`.
- A new module that needs a live resource at construction (queue, S3 client, …) must also be stubbed in `scripts/export-openapi.ts`, or the export will try to connect.

## Run

```bash
doppler run -- pnpm --filter @server/api dev   # → http://localhost:3001  (prefix /v1)
pnpm --filter @server/api test                  # Jest (unit + HTTP + Testcontainers integration)
pnpm --filter @server/api test -- token.service.spec.ts   # one test file
pnpm --filter @server/api test -- --watch
pnpm --filter @server/api typecheck             # src + test + scripts (tsconfig.spec.json)
pnpm --filter @server/api openapi:export        # write packages/sdk/openapi.json (no DB/Redis)
pnpm --filter @server/api lint                  # ESLint (type-checked @repo/config base), 0 warnings allowed
```

ESLint: `eslint.config.mjs` extends `@repo/config/eslint`; the project service lints `src/` with `tsconfig.json` and `test/` with `test/tsconfig.json` (extends `tsconfig.spec.json`). Under `test/**` only the `no-unsafe-*` and `unbound-method` rules are off (Jest mocks are `any`, `expect(obj.method)` is idiomatic). `tsconfig.json` extends `../packages/config/...` by relative path — typescript-eslint does not realpath the `@repo/config` symlink, so the package-name form breaks the `extends` chain.

Tests live in `server/test/` (excluded from the build). `jest.config.js` has two projects: **unit** (everything except `test/integration/` — `auth/`, `common/`, `config/`, `http/` in-process Fastify `inject` with mocked Prisma; no Docker) and **integration** (`test/integration/`, needs Docker; CI runners have it). `pnpm --filter @server/api test -- --selectProjects unit` skips Docker; selecting only unit files does too.

### Integration harness (`test/support/`)

- **Containers:** `global-setup.ts` starts ONE Postgres 16 + ONE Redis 7 per `jest` run (only if an integration spec is selected), runs `prisma migrate deploy` (packages/db/prisma) into a template DB, and clones `worker_N` per Jest worker; each worker also gets Redis logical DB N. `integration-env.ts` points `DATABASE_URL`/`REDIS_URL` at the worker's pair. Chosen over a container set per file: start-up + migrations cost ~5s once instead of per file (whole integration suite ≈ 8s wall). Never touches the shared local Postgres/Redis.
- **`createTestApp({ env?, imports? })`** → `TestApp { app, db, redis, env, authHeader(user), signAccessToken(user, roles, vendorId?), reset(), close() }`: the real `AppModule` on Fastify with the same plugins as `main.ts` (keep in sync), pino silenced, rate limits raised to 100000 (override via `env`). It starts from an empty DB (`reset()` = TRUNCATE all tables + FLUSHDB; it refuses to run on a non-`worker_N` database). Call `t.reset()` in `beforeEach` when tests must not see each other's rows. Test-only controllers go in a module passed via `imports` (that module imports `AuthModule` to use `JwtAuthGuard`).
- **Auth:** `await t.authHeader(user)` → `{ authorization: 'Bearer …' }` signed by the real `TokenService` from the user's DB roles (vendor roles only while the vendor is ACTIVE). `t.signAccessToken(user, roles, vendorId?)` crafts arbitrary claims (stale vendorId, revoked role).
- **Factories** (`factories.ts`, re-exported from `test/support`): `makeUser(db, { roles?, vendorId?, email?, … })`, `makeVendor(db, { status?, ownerId?, currency?, commissionBpsOverride? })` → `{ vendor, owner, wallet }` (owner gets `VENDOR_OWNER`), `makeCategory`, `makeProduct(db, { vendorId, status?, currency?, price?, variants?: [{ price?, stockOnHand?, stockReserved?, sku? }], categoryIds? })` (vi/en translations, variants, image), `makeShippingMethod(db, { vendorId, price?, … })`, `makeAddress(db, { userId, isDefault? })`, `makePlatformSettings(db, overrides)`. Amounts are integer minor units; ids are monotonic ULIDs (creation order = id order).

```ts
import { createTestApp, makeUser, makeVendor, type TestApp } from '../support';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

it('…', async () => {
  const { owner } = await makeVendor(t.db);
  const res = await t.app.inject({
    method: 'GET',
    url: '/v1/auth/me',
    headers: await t.authHeader(owner),
  });
});
```

Samples: `test/integration/harness.spec.ts`, `idempotency.spec.ts` (test controller + `@Idempotent()`), `rate-limit.spec.ts`, `refresh-token.store.spec.ts`.
