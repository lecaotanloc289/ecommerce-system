# server — API (`@server/api`)

Backend HTTP API. NestJS 11 + Fastify, versioned `/v1`, OpenAPI exposed. Serves all roles via REST; webhooks (payment, OAuth callback) terminate here. Code in `server/src/`.
Read the root `CLAUDE.md` first — it is the constitution (Golden Rules, NEVER DO, naming, data flow, domain model, migration, testing). This file holds only API-specific context.

Future async workers (outbox dispatcher, payout cron, email sender) live **OUTSIDE** this workspace — a sibling top-level dir like `workers/<name>/` if/when added.

## Tech stack

- NestJS 11 + Fastify adapter, prefix `/v1`
- `nestjs-zod` pipe (validation from schemas in `@repo/core`; global `ZodValidationPipe`, failures → 422)
- Auth: `@nestjs/passport` 11 + `passport-google-oauth20` + `passport-facebook` + `@nestjs/jwt` 11 (v12 of both is ESM-only / Nest 12 — stay on 11 while the server is CJS on Nest 11)
- Redis: `ioredis` 5 (`RedisModule`, token `REDIS`) — refresh-token sessions; BullMQ later
- Errors: global `DomainErrorFilter` — every error leaves as `{ errorCode, params }` (`@repo/core` `DomainError` / `ERROR_CODES`)
- Logger: `nestjs-pino`
- Security: `@fastify/helmet`, `@fastify/cors` (credentials true), `@fastify/cookie`
- OpenAPI: `@nestjs/swagger` → generates the client used by `@repo/sdk`
- Queue: BullMQ (Redis) for the outbox worker, payout scheduler, email sender

## Request pipeline

Controllers orchestrate only: middleware (helmet, cors, rate-limit, request-id) → `JwtAuthGuard` → `RolesGuard @Roles(...)` → `ZodValidationPipe` → controller → service. Business logic lives in services/domain. See root `CLAUDE.md` §4 (Data flow) for the worked checkout example.

## State (as of 2026-11-19)

- Bootstrap: NestJS 11 + Fastify, helmet + cors + cookie + pino, `GET /v1/health`, `GET /v1/health/ready` (DB probe via `PrismaService`).
- Config: `src/config/env.ts` — Zod schema parsed at boot (`ConfigModule`, inject `@Inject(ENV) env: Env`); missing/invalid keys abort startup with a list. Env is injected by Doppler (`doppler run -- pnpm --filter @server/api dev`) or your shell — the server does **not** read `.env` itself.
- Auth module (`src/auth/`) — see below.
- Not started: catalog, cart, checkout, orders, payments, payouts, idempotency, outbox.

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
- **Known limits:** access tokens stay valid until expiry (≤ 15m) after logout, family revocation, vendor suspension or role removal (no denylist / per-user session index yet) — services must re-check vendor status/ownership in the DB before destructive vendor or payout actions rather than trusting `req.user.vendorId` alone. The refresh cookie is always `Secure` (Golden Rule #5): Chrome/Firefox accept it on `http://localhost`, Safari may not — use Chrome for local login. SameSite=Lax means the API must be same-site with the web/admin origins in prod (e.g. `api.example.com` + `example.com`), otherwise the refresh cookie isn't sent. Request/response schemas live in `src/auth/auth.schemas.ts` until moved to `@repo/core/schemas` (TODO there).

## Run

```bash
doppler run -- pnpm --filter @server/api dev   # → http://localhost:3001  (prefix /v1)
pnpm --filter @server/api test                  # Jest (unit + HTTP + Testcontainers integration)
pnpm --filter @server/api test -- token.service.spec.ts   # one test file
pnpm --filter @server/api test -- --watch
pnpm --filter @server/api typecheck             # src + test (tsconfig.spec.json)
```

Tests live in `server/test/` (excluded from the build): `auth/` unit (guards, decorators, strategies, OAuth user resolution, rotation/reuse/logout), `http/` in-process Fastify `inject` flow, `integration/` real Redis via Testcontainers (needs Docker; CI runners have it). Planned integration coverage (Postgres): transaction rollback, idempotency replay, outbox publishing, ownership.
