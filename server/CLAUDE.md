# server — API (`@server/api`)

Backend HTTP API. NestJS 11 + Fastify, versioned `/v1`, OpenAPI exposed. Serves all roles via REST; webhooks (payment, OAuth callback) terminate here. Code in `server/src/`.
Read the root `CLAUDE.md` first — it is the constitution (Golden Rules, NEVER DO, naming, data flow, domain model, migration, testing). This file holds only API-specific context.

Future async workers (outbox dispatcher, payout cron, email sender) live **OUTSIDE** this workspace — a sibling top-level dir like `workers/<name>/` if/when added.

## Tech stack

- NestJS 11 + Fastify adapter, prefix `/v1`
- `nestjs-zod` pipe (validation from schemas in `@repo/core`)
- Auth: `@nestjs/passport` + `passport-google-oauth20` + `passport-facebook` + `@nestjs/jwt`
- Logger: `nestjs-pino`
- Security: `@fastify/helmet`, `@fastify/cors` (credentials true), `@fastify/cookie`
- OpenAPI: `@nestjs/swagger` → generates the client used by `@repo/sdk`
- Queue: BullMQ (Redis) for the outbox worker, payout scheduler, email sender

## Request pipeline

Controllers orchestrate only: middleware (helmet, cors, rate-limit, request-id) → `JwtAuthGuard` → `RolesGuard @Roles(...)` → `ZodValidationPipe` → controller → service. Business logic lives in services/domain. See root `CLAUDE.md` §4 (Data flow) for the worked checkout example.

## Scaffold state (as of 2026-05-20)

NestJS 11 + Fastify bootstrap with `GET /v1/health`; helmet + cors + cookie + pino. Domain logic (auth, services, payments) not started.

## Run

```bash
pnpm --filter @server/api dev        # → http://localhost:3001  (prefix /v1)
pnpm --filter @server/api test -- order.service.spec.ts   # one test file
pnpm --filter @server/api test -- --watch
```

Integration tests (Jest + Testcontainers: Postgres + Redis): transaction rollback, idempotency replay, outbox publishing, role + ownership guards.
