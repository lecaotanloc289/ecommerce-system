# @repo/sdk

Typed API client for web + admin, generated from the server's OpenAPI spec. Runs in browser and Node
(Next RSC). Depends on `@repo/core` (re-exported for response parsing); never on apps or server.

## Layout

| Path                  | What                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `openapi.json`        | Committed spec, exported from the server (sorted keys, deterministic). **Generated.**     |
| `src/schema.d.ts`     | `paths` / `components` types from `openapi-typescript`. **Generated — never hand-edit.**  |
| `src/client.ts`       | `createApiClient` (openapi-fetch + auth, idempotency, single-flight refresh)              |
| `src/index.ts`        | Public API: client, generated types, and `export * from '@repo/core'` (Zod schemas/types) |
| `test/client.test.ts` | Vitest: headers, idempotency key, refresh retry, single-flight, failure paths             |

## Regenerating

```bash
pnpm sdk:generate    # server openapi:export -> openapi.json -> openapi-typescript -> schema.d.ts -> build
```

Run it after any change to a controller, DTO or `@repo/core` schema used by a route, and commit the
diff. CI re-runs it and fails if `openapi.json` / `schema.d.ts` differ from the commit (drift check).
`openapi:export` needs no Postgres/Redis: it builds the real `AppModule` with stubbed `PrismaService` and
`REDIS` and a fixed dummy env (`server/scripts/export-openapi.ts`).

## Declaring a route so it appears in the SDK

1. Request/response shapes are Zod schemas (in `@repo/core/schemas/*`; auth ones still in `server/src/auth/auth.schemas.ts`).
2. In the server module, wrap each schema in a DTO class: `class FooDto extends createZodDto(FooSchema) {}`.
3. Request: type `@Body()` / `@Query()` / `@Param()` parameters with the DTO class (runtime validation + spec).
4. Response: `@ZodResponse({ status: 200, description: '...', type: FooDto })` (array: `type: [FooDto]`). It
   documents the response, sets the status, and serialises through the schema (global
   `ZodSerializerInterceptor`); the handler return type must match. For empty replies use
   `@ApiNoContentResponse()` + `@HttpCode(204)`.
5. Add `@ApiTags('<module>')`, `@ApiOperation({ summary })`, and `@ApiBearerAuth(BEARER_AUTH)` /
   `@ApiCookieAuth(REFRESH_COOKIE_AUTH)` (from `server/src/openapi/openapi.ts`) on protected routes.
6. Run `pnpm sdk:generate`, commit `openapi.json` + `src/schema.d.ts`.

A route with no response decorator still appears but with an untyped response — always add one.

## Usage

```ts
import { createApiClient } from '@repo/sdk';

let accessToken: string | null = null; // in memory only — never localStorage/sessionStorage
const api = createApiClient({
  baseUrl: 'http://localhost:3001', // origin only; generated paths already start with /v1
  getAccessToken: () => accessToken,
  onAccessToken: (token) => (accessToken = token),
  onUnauthorized: () => window.location.assign('/login'),
});

const { data, error } = await api.GET('/v1/auth/me');
await api.POST('/v1/auth/logout'); // gets an auto Idempotency-Key
```

## Behaviour

- `Authorization: Bearer <token>` from `getAccessToken` (a caller-supplied header wins); `credentials: 'include'`.
- POST/PUT/PATCH get a ULID `Idempotency-Key` unless the caller passes one (Golden Rule #3). To make a user
  action safely retryable, generate the key once per action and pass it via `headers`.
- On 401: one `POST /v1/auth/refresh` shared by all concurrent callers (the server rotates the cookie, so
  parallel refreshes would log the user out), then the original request is retried once with the new token
  and the same `Idempotency-Key`. A 4xx from refresh calls `onUnauthorized` and the original 401 is returned.
  Network failures during refresh do not call `onUnauthorized`.
- The client never reads or writes cookies or storage; the refresh cookie is HttpOnly. Server-side (RSC),
  pass a custom `fetch` that forwards the incoming `cookie` header if you need to refresh there.

## Rules

- `src/schema.d.ts` and `openapi.json` are excluded from Prettier (generated); never edit them by hand.
- tsconfig adds the `DOM` lib (global `fetch`/`Request`/`Response` types) — the package is isomorphic.
- `lint` is still a placeholder like the other packages until ESLint lands repo-wide (T0.2).
