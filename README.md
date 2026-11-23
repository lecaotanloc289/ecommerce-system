# Elma — Multi-vendor e-commerce monorepo

International multi-vendor marketplace (vi + en, VND + USD) with three actors: **Customer · Vendor · Platform**. A single order containing items from multiple vendors is automatically split into sub-orders per vendor inside one DB transaction; funds flow through platform escrow and release to vendors after a hold period (minus commission).

The full constitution lives in [`CLAUDE.md`](./CLAUDE.md) — read that before contributing. Golden Rules and the NEVER DO list are enforced in code review.

---

## Workspaces

| Path                | Package          | Role                                                                   |
| ------------------- | ---------------- | ---------------------------------------------------------------------- |
| `apps/client`       | `@apps/web`      | Next.js 15 storefront on Cloudflare Workers (OpenNext), i18n vi/en     |
| `apps/admin`        | `@apps/admin`    | Vite 6 + React 19 dashboard (platform console + vendor portal)         |
| `server`            | `@server/api`    | NestJS 11 + Fastify API, prefix `/v1`, OpenAPI export                  |
| `workers/jobs`      | `@workers/jobs`  | Outbox dispatcher (payment sessions, refunds, emails) + scheduled jobs |
| `workers/zalo`      | `@workers/zalo`  | Shop Zalo sessions (zca-js) + automated order messages                 |
| `e2e`               | `@repo/e2e`      | Playwright smoke flows over the whole stack                            |
| `packages/core`     | `@repo/core`     | Zod schemas, types, Money utility, pricing + ledger rules, enums       |
| `packages/db`       | `@repo/db`       | Prisma client + schema + migrations + seed                             |
| `packages/sdk`      | `@repo/sdk`      | Typed API client generated from OpenAPI                                |
| `packages/payments` | `@repo/payments` | `PaymentProvider` interface + VNPay / Stripe adapters                  |
| `packages/i18n`     | `@repo/i18n`     | vi/en message catalogs + formatters                                    |
| `packages/ui`       | `@repo/ui`       | shadcn/ui components + design tokens (Tailwind v4)                     |
| `packages/config`   | `@repo/config`   | Shared ESLint / TS / Prettier configs                                  |

Dependency rule: `apps/* → packages/*` and `server → packages/*` only. `apps/*` never imports from `apps/*` or `server`; `workers/*` never imports from `server` or `apps/*` and talks to the API only through the DB / outbox. Full map in [`CLAUDE.md` §3](./CLAUDE.md#3-monorepo-map).

---

## Current state

Per-workspace status (what is done, known gaps) lives in [`CLAUDE.md` §1](./CLAUDE.md#implementation-status-as-of-2026-11-24) and in each workspace's own `CLAUDE.md`.

Design tokens (`packages/ui/src/styles/tokens.css`) hold the **authoritative** values pulled from the Figma "Elma eCommerce UI Kit" style guide:

- Brand: Indigo `#5C6AC4` · status palette (Green `#50B83C` · Yellow `#EEC200` · Red `#DE3618` · Blue `#006FBB`) · accents (Purple `#9C6ADE` · Teal `#47C1BF` · Orange `#F49342`)
- Neutral: Polaris-style scale (`#161B25` → `#F9FAFB`)
- Layout: 1100 px container, 30 px gutter, 12-col grid
- Typography: Poppins · H1 56/72 → H9 12/16 (8 styles + caption, each w/ Bold · Medium · Regular)

Full spec: [`docs/design-spec.md`](./docs/design-spec.md).

---

## Quick start

```bash
# 1. Tooling
node --version        # 22.x (see .nvmrc)
corepack enable       # provides pnpm

# 2. Install
pnpm install

# 3. Local infra (Postgres 16 + Redis 7 + RustFS S3 + Mailhog)
pnpm services:up

# 4. Env: Vite (admin) reads the root .env; the API and workers read the shell or Doppler
#    (doppler.yaml). Fill in OAuth client IDs, JWT secrets, etc. See .env.example.
cp .env.example .env

# 5. Database: apply migrations and load the idempotent demo seed
pnpm db:migrate
pnpm db:seed

# 6. Dev (all workspaces in parallel via Turbo)
pnpm dev
```

### Filter to one workspace

```bash
pnpm --filter @apps/web dev            # storefront          → http://localhost:3000
pnpm --filter @apps/admin dev          # admin               → http://localhost:5173
pnpm --filter @server/api dev          # API                 → http://localhost:3001
pnpm --filter @workers/jobs dev        # jobs worker (no HTTP)
pnpm --filter @workers/zalo dev        # Zalo worker (no HTTP)
```

### Design-system showcase

```bash
pnpm --filter @apps/web dev
# → http://localhost:3000/vi/design-system
```

Every base component in `@repo/ui` rendered with all variants + states. Use this page to verify visual regressions before merging UI changes.

---

## Quality gates

Every PR must pass:

```bash
pnpm format:check  # Prettier --check (CI)
pnpm lint          # ESLint flat config (@repo/config/eslint)
pnpm typecheck     # tsc --noEmit per workspace
pnpm test          # Vitest (packages, workers, apps) + Jest (server); @repo/db tests need DATABASE_URL + SHADOW_DATABASE_URL, server and worker integration suites need Docker (Testcontainers)
pnpm build         # Turbo: build all workspaces
```

Cross-system browser smoke flows (slow, not part of `pnpm test`):

```bash
pnpm e2e           # Playwright over the real API + worker + storefront + admin (needs Postgres + Redis)
pnpm e2e:headed    # same with a visible browser
```

Details, env vars and how auth/payments are faked: [`e2e/CLAUDE.md`](./e2e/CLAUDE.md).

CI (`ci.yml`, on PRs and pushes to `dev` / `prod`) runs the SDK drift check, format check, lint, typecheck, test and build (Postgres service for `@repo/db`; the Testcontainers suites use Docker on the runner). The e2e workflow (`e2e.yml`) runs on PRs into `prod` and on manual dispatch. The pre-commit hook (`husky` + `lint-staged`) runs Prettier `--write` on staged files.

Commits follow [Conventional Commits](https://www.conventionalcommits.org). Branches: `feat/`, `fix/`, `chore/`, `refactor/`. Default base: `prod` (renamed from `main`); active work branches off `dev`.

---

## Database

```bash
pnpm db:generate            # regenerate Prisma Client
pnpm db:migrate             # migrate dev — creates a new migration
pnpm --filter @repo/db migrate:deploy   # apply committed migrations only (CI / prod)
pnpm db:reset               # drop + reapply + seed   — LOCAL ONLY
pnpm db:seed                # idempotent seed
```

## API client (`@repo/sdk`)

```bash
pnpm sdk:generate           # export OpenAPI from the server -> packages/sdk/openapi.json -> types -> build SDK
```

Run it after changing a controller or a schema it uses and commit the result; CI fails on drift. No
database/Redis needed. See [`packages/sdk/CLAUDE.md`](./packages/sdk/CLAUDE.md).

Migrations are **forward-only**. Destructive changes (drop column, rename) require a two-phase migration — see [`CLAUDE.md` §9](./CLAUDE.md#9-database-migration).

---

## Ports

| Service       | Port        | Notes                                                                                                      |
| ------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `@apps/web`   | 3000        | Next.js storefront                                                                                         |
| `@server/api` | 3001        | NestJS + Fastify, prefix `/v1`                                                                             |
| `@apps/admin` | 5173        | Vite dev server                                                                                            |
| `workers/*`   | —           | No HTTP port (Postgres + Redis only)                                                                       |
| `e2e`         | 4100–4104   | Test-only ports, never 3000 / 3001 / 5173 (see `e2e/CLAUDE.md`)                                            |
| Postgres      | 5432        | DBs: `ecommerce`, `ecommerce_shadow` (created by `docker/postgres-init.sql`)                               |
| Redis         | 6379        | Cache, rate limit, sessions, BullMQ                                                                        |
| RustFS (S3)   | 9000 / 9001 | S3 API / web console (local `rustfsadmin` / `rustfsadmin`); buckets `kyc` (private), `media` (public read) |
| Mailhog       | 1025 / 8025 | SMTP / web UI                                                                                              |

---

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — constitution: golden rules, never-do list, naming, data flow, business domain.
- [`docs/design-spec.md`](./docs/design-spec.md) — Figma → code design contract (tokens, components, interactions, layout).
- [`packages/ui/src/styles/tokens.css`](./packages/ui/src/styles/tokens.css) — runtime design tokens (`@theme` block).

---

## Deploy

CI/CD is driven by GitHub Actions. Two branches → two environments:

| Branch | Trigger                  | Environment    | Web (Worker)                          | Admin                      | API                     |
| ------ | ------------------------ | -------------- | ------------------------------------- | -------------------------- | ----------------------- |
| `dev`  | push (incl. merged PRs)  | **dev**        | `elma-web-dev.<account>.workers.dev`  | `dev.elma-admin.pages.dev` | `elma-api-dev.fly.dev`  |
| `prod` | push (merged from `dev`) | **production** | `elma-web-prod.<account>.workers.dev` | `elma-admin.pages.dev`     | `elma-api-prod.fly.dev` |

Workflows live in `.github/workflows/`:

- `ci.yml` — lint + typecheck + test + build (runs on PRs + every push to `dev` / `prod`)
- `deploy-web.yml` — `opennextjs-cloudflare build` → `opennextjs-cloudflare deploy --env <branch>` (Next.js SSR on a Cloudflare Worker, `apps/client/wrangler.jsonc`)
- `deploy-admin.yml` — `vite build` → `wrangler pages deploy apps/admin/dist`
- `deploy-server.yml` — `flyctl deploy --remote-only --app elma-api-${{ github.ref_name }}` → smoke check `/v1/health`
- `deploy-worker.yml` — `flyctl deploy` of `workers/jobs` (Fly app `elma-worker-{dev,prod}`) on changes under `workers/jobs/**`. `workers/zalo` has no deploy workflow yet.
- `e2e.yml` — Playwright flows (`pnpm e2e`) on PRs into `prod` and on manual dispatch

Each deploy workflow only fires when files in the relevant workspace change (path filters).

Full architecture, secret inventory, and one-time external-account setup steps live in [`docs/ci-cd-plan.md`](./docs/ci-cd-plan.md). Rollback drill: revert the last commit on `prod` and push — workflow redeploys the previous artifact in ~3 minutes.

## License

Private — internal use only. Do **not** commit `.env*`, `*.pem`, keys, tokens, or KYC files. Only `.env.example` may be tracked.
