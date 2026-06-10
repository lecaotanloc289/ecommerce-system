# syntax=docker/dockerfile:1.7

# ---------- base ----------
FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# ---------- deps ----------
# Install workspace deps with the lockfile so layer caches on lockfile only.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY server/package.json server/
COPY packages packages/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --filter @server/api... --frozen-lockfile

# ---------- build ----------
FROM base AS build
COPY --from=deps /repo /repo
COPY tsconfig.base.json ./
COPY server server
RUN pnpm --filter @server/api build

# ---------- runtime ----------
FROM node:20-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app
# Copy compiled JS + minimal package metadata
COPY --from=build /repo/server/dist ./dist
COPY --from=build /repo/server/package.json ./
COPY --from=build /repo/node_modules ./node_modules
# Drop dev deps (rough but effective; the build image is discarded anyway)
RUN node -e "const p=require('./package.json');delete p.devDependencies;require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
EXPOSE 3001
CMD ["node", "dist/main.js"]
