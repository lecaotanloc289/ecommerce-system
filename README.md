# Elma — Multi-vendor e-commerce monorepo

International multi-vendor marketplace (vi + en, VND + USD) with three actors: **Customer · Vendor · Platform**. A single order containing items from multiple vendors is automatically split into sub-orders per vendor inside one DB transaction; funds flow through platform escrow and release to vendors after a hold period (minus commission).

The full constitution lives in [`CLAUDE.md`](./CLAUDE.md) — read that before contributing. Golden Rules and the NEVER DO list are enforced in code review.

---

## Workspaces

| Path                | Package          | Role                                                              |
| ------------------- | ---------------- | ----------------------------------------------------------------- |
| `apps/web`          | `@apps/web`      | Next.js 15 storefront (customer-facing, i18n vi/en)               |
| `apps/admin`        | `@apps/admin`    | Vite 6 + React 19 dashboard (platform admin + vendor portal)      |
| `server`            | `@server/api`    | NestJS 11 + Fastify API, prefix `/v1`                             |
| `packages/ui`       | `@repo/ui`       | shadcn/ui components + design tokens (Tailwind v4)                |
| `packages/core`     | `@repo/core`     | Zod schemas, types, Money utility, enums (single source of truth) |
| `packages/db`       | `@repo/db`       | Prisma client + schema + migrations + seed                        |
| `packages/sdk`      | `@repo/sdk`      | Typed API client generated from OpenAPI                           |
| `packages/payments` | `@repo/payments` | `PaymentProvider` interface + VNPay / Stripe adapters             |
| `packages/i18n`     | `@repo/i18n`     | vi/en message catalogs + formatters                               |
| `packages/config`   | `@repo/config`   | Shared ESLint / TS / Prettier configs                             |

Dependency rule: `apps/* → packages/*` and `server → packages/*` only. `apps/*` never imports from `apps/*` or `server`. Full map in [`CLAUDE.md` §3](./CLAUDE.md#3-monorepo-map).

---

## Current state (2026-05-21)

| Workspace                                     | Status                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `server`                                      | NestJS 11 + Fastify bootstrap with `GET /v1/health`; helmet + cors + cookie + pino                           |
| `apps/web`                                    | Next 15 App Router scaffold + `/design-system` showcase, Tailwind v4                                         |
| `apps/admin`                                  | Vite 6 + React 19 scaffold, Tailwind v4 (no routes yet)                                                      |
| `packages/ui`                                 | 20 base components (Button, Input, Select, Dialog, Drawer, Table, Pagination, Toast…) wired to design tokens |
| `packages/{core,db,sdk,payments,i18n,config}` | Placeholders only — empty `src/index.ts`                                                                     |

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
node --version        # 20.x (see .nvmrc)
corepack enable       # provides pnpm

# 2. Install
pnpm install

# 3. Env
cp .env.example .env  # fill in OAuth client IDs, JWT secrets, etc.

# 4. Local infra (Postgres + Redis + MinIO + Mailhog)
pnpm services:up

# 5. Dev (all workspaces in parallel via Turbo)
pnpm dev
```

### Filter to one workspace

```bash
pnpm --filter @apps/web dev       # storefront         → http://localhost:3000
pnpm --filter @apps/admin dev     # admin              → http://localhost:5173
pnpm --filter @server/api dev     # API                → http://localhost:3001
```

### Design-system showcase

```bash
pnpm --filter @apps/web dev
# → http://localhost:3000/design-system
```

Every base component in `@repo/ui` rendered with all variants + states. Use this page to verify visual regressions before merging UI changes.

---

## Quality gates

Every PR must pass:

```bash
pnpm lint          # ESLint flat config (@repo/config/eslint)
pnpm typecheck     # tsc --noEmit per workspace
pnpm test          # Vitest (packages) + Jest (server) + Playwright (apps)
pnpm build         # Turbo: build all workspaces
```

CI runs these on GitHub Actions before merge. The pre-commit hook (`husky` + `lint-staged`) runs `lint` + `typecheck` on changed files.

Commits follow [Conventional Commits](https://www.conventionalcommits.org). Branches: `feat/`, `fix/`, `chore/`, `refactor/`. Default base: `prod` (renamed from `main`); active work branches off `dev`.

---

## Database

```bash
pnpm db:generate            # regenerate Prisma Client
pnpm db:migrate             # migrate dev — creates a new migration
pnpm db:reset               # drop + reapply + seed   — LOCAL ONLY
pnpm db:seed                # idempotent seed
```

Migrations are **forward-only**. Destructive changes (drop column, rename) require a two-phase migration — see [`CLAUDE.md` §9](./CLAUDE.md#9-database-migration).

---

## Ports

| Service       | Port        | Notes                                |
| ------------- | ----------- | ------------------------------------ |
| `@apps/web`   | 3000        | Next.js storefront                   |
| `@server/api` | 3001        | NestJS + Fastify, prefix `/v1`       |
| `@apps/admin` | 5173        | Vite dev server                      |
| Postgres      | 5432        | DBs: `ecommerce`, `ecommerce_shadow` |
| Redis         | 6379        | Cache + BullMQ                       |
| MinIO         | 9000 / 9001 | S3 API / web console                 |
| Mailhog       | 1025 / 8025 | SMTP / web UI                        |

---

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — constitution: golden rules, never-do list, naming, data flow, business domain.
- [`docs/design-spec.md`](./docs/design-spec.md) — Figma → code design contract (tokens, components, interactions, layout).
- [`packages/ui/src/styles/tokens.css`](./packages/ui/src/styles/tokens.css) — runtime design tokens (`@theme` block).

---

## Deploy

CI/CD is driven by GitHub Actions. Two branches → two environments:

| Branch | Trigger                  | Environment    | Web                      | Admin                      | API                     |
| ------ | ------------------------ | -------------- | ------------------------ | -------------------------- | ----------------------- |
| `dev`  | push (incl. merged PRs)  | **dev**        | `dev.elma-web.pages.dev` | `dev.elma-admin.pages.dev` | `elma-api-dev.fly.dev`  |
| `prod` | push (merged from `dev`) | **production** | `elma-web.pages.dev`     | `elma-admin.pages.dev`     | `elma-api-prod.fly.dev` |

Workflows live in `.github/workflows/`:

- `ci.yml` — lint + typecheck + test + build (runs on PRs + every push to `dev` / `prod`)
- `deploy-web.yml` — `pnpm build` → `wrangler pages deploy apps/web/out` (Next.js static export)
- `deploy-admin.yml` — `vite build` → `wrangler pages deploy apps/admin/dist`
- `deploy-server.yml` — `flyctl deploy --remote-only --app elma-api-${{ github.ref_name }}` → smoke check `/v1/health`

Each deploy workflow only fires when files in the relevant workspace change (path filters).

Full architecture, secret inventory, and one-time external-account setup steps live in [`docs/ci-cd-plan.md`](./docs/ci-cd-plan.md). Rollback drill: revert the last commit on `prod` and push — workflow redeploys the previous artifact in ~3 minutes.

## License

Private — internal use only. Do **not** commit `.env*`, `*.pem`, keys, tokens, or KYC files. Only `.env.example` may be tracked.
