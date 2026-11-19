# CI/CD Setup — Cloudflare Pages + Fly.io

## Context

Elma e-commerce monorepo currently has:

- `.github/workflows/ci.yml` that lints / typechecks / tests / builds — but does **not deploy** anywhere.
- No `Dockerfile`, no platform configs (Vercel / Fly / Railway / Cloudflare).
- Branches: `dev` (active) + `prod` (production trunk — already renamed on origin from the old `main`).
- 3 deployables: `apps/web` (Next.js 15), `apps/admin` (Vite SPA), `server` (NestJS + Fastify).

Goal: every push to `dev` triggers a build + deploy of all 3 to the **dev environment**; every push to `prod` (merged from `dev`) triggers the same to the **production environment**.

Chosen stack (per user answers):

| Concern                   | Platform                                                           |
| ------------------------- | ------------------------------------------------------------------ |
| `apps/web` + `apps/admin` | **Cloudflare Pages** (subdomain `*.pages.dev`)                     |
| `server`                  | **Fly.io** Docker (subdomain `*.fly.dev`)                          |
| Postgres                  | **Neon** — DB branches per env                                     |
| Redis                     | **Upstash** — 2 separate databases                                 |
| Secrets                   | GitHub Actions repo secrets, mirrored to Fly via `fly secrets set` |

---

## Branch model

```
feature/* ──PR──▶ dev ────push────▶ Deploy DEV
                   │
                   └──PR──▶ prod ────push────▶ Deploy PROD
```

Steps:

1. **Already done** by the user: `main` → `prod` on origin. Local clone still shows `main` (stale) — refresh once:
   ```bash
   git fetch --prune
   git branch -m main prod              # rename local pointer
   git branch --set-upstream-to=origin/prod prod
   ```
2. Confirm `prod` is GitHub's default branch (Settings → Branches → Default branch). PRs from `dev` will target it.
3. Add branch-protection on `prod`: require PR + green CI + 1 review before merge. Recommended for `dev` too.

---

## File map (every file to create or edit)

### New — platform configs

| Path                                  | Purpose                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `server/Dockerfile`                   | Multi-stage Node 20 build → small runtime image                                             |
| `server/.dockerignore`                | Exclude `node_modules`, `.next`, `dist`, tests, env files                                   |
| `server/fly.toml`                     | Fly app config (region `sin`, internal port `3001`, health check `/v1/health`)              |
| `apps/web/wrangler.toml` _(optional)_ | If using `@cloudflare/next-on-pages` CLI; alternative is configuring via CF Pages dashboard |

### New — GitHub Actions workflows

| Path                                            | Triggers                                 | Jobs                                                   |
| ----------------------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| `.github/workflows/ci.yml` _(replace existing)_ | PR open + push to `dev` + push to `prod` | `lint` · `typecheck` · `test` · `build`                |
| `.github/workflows/deploy-web.yml`              | push to `dev` or `prod`                  | Build Next.js w/ CF adapter → `wrangler pages deploy`  |
| `.github/workflows/deploy-admin.yml`            | push to `dev` or `prod`                  | Build Vite → `wrangler pages deploy ./apps/admin/dist` |
| `.github/workflows/deploy-server.yml`           | push to `dev` or `prod`                  | `flyctl deploy --app $APP --remote-only`               |

Each deploy workflow:

- `needs: ci` to gate on green tests.
- Branch-based env selection: `${{ github.ref_name }}` is already `dev` or `prod`, used directly as the secret suffix and Fly app suffix.
- Concurrency group `deploy-${{ github.workflow }}-${{ github.ref }}` w/ `cancel-in-progress: true`.
- pnpm + Turbo cache restored from `actions/cache` keyed on `pnpm-lock.yaml` + `turbo.json`.

### Edits

| Path                      | Change                                                                         |
| ------------------------- | ------------------------------------------------------------------------------ |
| `apps/web/package.json`   | Add devDep `@cloudflare/next-on-pages` + `wrangler`; add `pages:build` script  |
| `apps/web/next.config.ts` | No code change yet — adapter is run as a CLI step, not via config              |
| `apps/admin/package.json` | Add devDep `wrangler`                                                          |
| `.env.example`            | Add comment block listing the GitHub secret keys + Fly secret keys (no values) |
| `README.md`               | Add a brief "Deploy" section pointing at the workflows + the 6 public URLs     |

---

## Cloudflare Pages — projects to create

Create via dashboard (one-time, manual):

| CF Pages project | Production branch | Preview branches | Public URL                                                   |
| ---------------- | ----------------- | ---------------- | ------------------------------------------------------------ |
| `elma-web`       | `prod`            | `dev`            | prod `elma-web.pages.dev` · dev `dev.elma-web.pages.dev`     |
| `elma-admin`     | `prod`            | `dev`            | prod `elma-admin.pages.dev` · dev `dev.elma-admin.pages.dev` |

Connect each project's GitHub source to the repo so CF's own auto-deploy is **disabled** — Actions drive the deploys via `wrangler pages deploy`. (CF auto-deploy can't run our pnpm/Turbo monorepo build correctly.)

---

## Fly.io — apps to create

```bash
fly launch --no-deploy --name elma-api-dev  --region sin --copy-config server/fly.toml
fly launch --no-deploy --name elma-api-prod --region sin --copy-config server/fly.toml
```

Size: `shared-cpu-1x 256mb` for `elma-api-dev` (~$1.94 / mo), `512mb` for `elma-api-prod`.

Secrets set per app via `fly secrets set --app elma-api-{dev|prod} KEY=value` (see secret list below).

`server/fly.toml`:

```toml
app = "elma-api-dev"           # overridden at deploy via --app flag
primary_region = "sin"
[build]
  dockerfile = "Dockerfile"
[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = "stop"   # dev only; prod uses "off"
  min_machines_running = 0      # dev only; prod uses 1
[[http_service.checks]]
  grace_period = "10s"
  interval = "30s"
  method = "get"
  path = "/v1/health"
  timeout = "5s"
```

`server/Dockerfile` outline:

```dockerfile
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json server/
COPY packages packages/
RUN pnpm install --filter @server/api --frozen-lockfile

FROM base AS build
COPY --from=deps /app /app
COPY server server
COPY tsconfig.base.json .
RUN pnpm --filter @server/api build

FROM base AS runtime
ENV NODE_ENV=production PORT=3001
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/package.json server/
COPY --from=build /app/node_modules node_modules
EXPOSE 3001
CMD ["node", "server/dist/main.js"]
```

---

## Neon — DB branching

One Neon project `elma`:

- Default branch `prod` (used by `elma-api-prod`).
- Child branch `dev` (used by `elma-api-dev`). Created from `prod` so schema is in sync; can be reset on demand.

Connection strings (pooled + direct) stored as GitHub secrets `DATABASE_URL_DEV` / `DATABASE_URL_PROD` and `SHADOW_DATABASE_URL_DEV` / `_PROD`.

Optional follow-up: GitHub Action that branches Neon per PR (`@neondatabase/create-branch-action`) — out of scope for v1.

---

## Upstash — Redis

Two databases:

- `elma-dev` (regional Singapore, free tier — 10 000 commands / day, plenty for dev).
- `elma-prod` (regional Singapore, pay-as-you-go).

Connection URLs stored as `REDIS_URL_DEV` / `REDIS_URL_PROD`.

---

## Secrets — exact keys

**GitHub repo secrets** (one of each per env unless noted):

```
CLOUDFLARE_API_TOKEN          # one — both envs share; scoped to "Pages: edit"
CLOUDFLARE_ACCOUNT_ID         # one
FLY_API_TOKEN                 # one — generate with `fly tokens create deploy`

DATABASE_URL_DEV
DATABASE_URL_PROD
SHADOW_DATABASE_URL_DEV
SHADOW_DATABASE_URL_PROD
REDIS_URL_DEV
REDIS_URL_PROD

JWT_ACCESS_SECRET_DEV
JWT_ACCESS_SECRET_PROD
JWT_REFRESH_SECRET_DEV
JWT_REFRESH_SECRET_PROD

GOOGLE_OAUTH_CLIENT_ID_DEV
GOOGLE_OAUTH_CLIENT_ID_PROD
GOOGLE_OAUTH_CLIENT_SECRET_DEV
GOOGLE_OAUTH_CLIENT_SECRET_PROD
FACEBOOK_OAUTH_CLIENT_ID_DEV
FACEBOOK_OAUTH_CLIENT_ID_PROD
FACEBOOK_OAUTH_CLIENT_SECRET_DEV
FACEBOOK_OAUTH_CLIENT_SECRET_PROD

VNPAY_TMN_CODE_DEV / _PROD
VNPAY_HASH_SECRET_DEV / _PROD
STRIPE_SECRET_KEY_DEV / _PROD
STRIPE_WEBHOOK_SECRET_DEV / _PROD

SMTP_HOST_DEV / _PROD
SMTP_USER_DEV / _PROD
SMTP_PASS_DEV / _PROD
```

Frontend-public env vars (`NEXT_PUBLIC_API_URL`, `VITE_API_URL`) are injected at **build time** by the deploy workflow — not stored in secrets, because they are public anyway:

```yaml
env:
  NEXT_PUBLIC_API_URL: https://elma-api-${{ github.ref_name }}.fly.dev
```

Same pattern for `VITE_API_URL` in the admin workflow. Because `github.ref_name` is already `dev` or `prod`, the URL resolves correctly with no `if/else`.

---

## Reused / existing assets

- **`turbo.json`** already declares `build` outputs (`.next/**`, `dist/**`) — `actions/cache` can key on its hash.
- **`pnpm-lock.yaml`** + `pnpm-workspace.yaml` already in place — Actions uses `pnpm/action-setup@v4` w/ frozen lockfile.
- **Existing `.github/workflows/ci.yml`** stays the foundation — only add triggers for `dev` + `production` and downgrade `main` from the triggers list.
- **Existing `pnpm dev` / `pnpm build` pipelines** are unchanged — the workflows just call them.
- **Existing `.env.example`** documents all runtime variables — secret list above is the same set, split by env.

---

## Order of execution (when the user gives green light)

0. **Persist this plan inside the repo** so the team can reference it without leaving git.
   - Copy this file to `docs/ci-cd-plan.md` on the `dev` branch.
   - Commit alone (`docs(ci): persist deploy plan`) before any code changes — gives a clean rollback anchor if anything below goes sideways.

1. Branch / local hygiene
   - `git fetch --prune`
   - `git branch -m main prod` (or `git branch -D main && git switch -t origin/prod`).
   - `git branch --set-upstream-to=origin/prod prod`.
   - GitHub: confirm default branch = `prod`, add branch protection (PR + green CI + 1 review).

2. External account prep (manual, one-time, **user does this**)
   - Create Neon project `elma` + `dev` branch; copy 4 connection strings.
   - Create Upstash DBs `elma-dev` + `elma-prod`; copy URLs.
   - Create CF Pages projects `elma-web` + `elma-admin` linked to GitHub repo, **auto-deploy off**, prod branch = `prod`.
   - Create Fly apps `elma-api-dev` + `elma-api-prod`; `fly secrets set` for each.
   - Create CF API token + Fly deploy token + add all GitHub repo secrets listed above.

3. Code changes (PR on `dev`)
   - Add `server/Dockerfile`, `server/.dockerignore`, `server/fly.toml`.
   - Add 3 deploy workflows.
   - Update `ci.yml` triggers to `dev` + `prod`.
   - Add `@cloudflare/next-on-pages` + `wrangler` to `apps/web` devDeps; add `wrangler` to `apps/admin` devDeps.
   - Update `.env.example` + `README.md` deploy section.
   - Commit on `dev`.

4. First-run validation
   - Push `dev` → watch Actions → confirm 3 deploys complete green.
   - Hit dev endpoints (see Verification).
   - PR `dev` → `prod` → merge → confirm prod deploys.

---

## Verification

After step 4 (first push to `dev`):

```bash
# 1. CI gate
gh run watch                                       # follows the latest run

# 2. Server health
curl -sS https://elma-api-dev.fly.dev/v1/health     # → {"status":"ok"} expected
fly status --app elma-api-dev                      # at least 1 machine "passing"

# 3. Web + admin
curl -sS -o /dev/null -w "%{http_code}\n" https://dev.elma-web.pages.dev/
curl -sS -o /dev/null -w "%{http_code}\n" https://dev.elma-web.pages.dev/design-system
curl -sS -o /dev/null -w "%{http_code}\n" https://dev.elma-admin.pages.dev/

# 4. Browser smoke test
open https://dev.elma-web.pages.dev/design-system     # tokens render, no console errors
open https://dev.elma-admin.pages.dev/

# 5. DB connectivity
fly ssh console --app elma-api-dev -C "node -e \"require('@prisma/client');console.log('ok')\""
```

After merging `dev → prod`:

```bash
gh run watch
curl -sS https://elma-api-prod.fly.dev/v1/health
curl -sS -o /dev/null -w "%{http_code}\n" https://elma-web.pages.dev/
curl -sS -o /dev/null -w "%{http_code}\n" https://elma-admin.pages.dev/
```

Rollback drill: revert the last commit on `prod` and push — workflow redeploys the previous artifact within ~3 minutes.

---

## Out of scope (call out for follow-ups)

- Auto-branching Neon per PR.
- Turbo remote cache backed by Cloudflare R2 (speeds up CI by ~40 %).
- Custom domains (waiting on user to buy / point CNAMEs).
- Sentry / OpenTelemetry wiring.
- Migration runner step (`prisma migrate deploy`) — should be added once `packages/db` is real; placeholder in plan.
- E2E (Playwright) post-deploy smoke tests in CI.

---

## Public URLs (after first deploy)

| Service    | Dev                                | Production                      |
| ---------- | ---------------------------------- | ------------------------------- |
| Storefront | `https://dev.elma-web.pages.dev`   | `https://elma-web.pages.dev`    |
| Admin      | `https://dev.elma-admin.pages.dev` | `https://elma-admin.pages.dev`  |
| API        | `https://elma-api-dev.fly.dev`     | `https://elma-api-prod.fly.dev` |
