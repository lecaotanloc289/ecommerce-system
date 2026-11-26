# syntax=docker/dockerfile:1.7
# Build context = repo root: `docker build -f workers/jobs/Dockerfile .`
# (BuildKit reads workers/jobs/Dockerfile.dockerignore for this Dockerfile.)

# ---------- base ----------
FROM node:24-slim AS base
# Prisma's query engine needs OpenSSL.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# ---------- build ----------
# Only the worker and the packages it needs; root devDeps (tsup, turbo) come with the root project.
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages packages/
COPY workers/jobs workers/jobs/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@workers/jobs..." --filter "ecommerce-system"
RUN pnpm --filter @repo/db generate \
    && pnpm --filter "@workers/jobs..." run build

# ---------- runtime ----------
# Keeps the pnpm layout (workspace symlinks into packages/*/dist and the generated Prisma client).
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/workers/jobs
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]
