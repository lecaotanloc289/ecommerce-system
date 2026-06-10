# apps/admin — Platform admin + Vendor dashboard (`@apps/admin`)

Vite SPA serving two portals: platform admin and vendor dashboard. Package name `@apps/admin`.
Read the root `CLAUDE.md` first — it is the constitution (Golden Rules, NEVER DO, naming, data flow, domain model). This file holds only admin-specific context.

**Roles served:**

- `VENDOR_OWNER`, `VENDOR_STAFF` → `/vendor/*` routes
- `PLATFORM_STAFF`, `PLATFORM_ADMIN` → `/platform/*` routes

## Tech stack

- Vite 6 + React 19 + React Router 7
- TanStack Query (server state), Zustand (UI/local state — modals, filter drafts)
- Tailwind v4 via **`@tailwindcss/vite`** plugin (declared in `vite.config.ts`, no postcss config). shadcn/ui from `@repo/ui` (shared); locally configured with `components.json` (`rsc: false`, otherwise same as web). `cn()` helper in `src/lib/utils.ts`.
- Role-based routing: `/platform/*` (PLATFORM_ADMIN, PLATFORM_STAFF), `/vendor/*` (VENDOR_OWNER, VENDOR_STAFF)

## Scaffold state (as of 2026-05-20)

Vite 6 + React 19 hello page, Tailwind v4, shadcn config + `Button` installed. Domain pages not started.

## Run

```bash
pnpm --filter @apps/admin dev        # → http://localhost:5173
```

E2E (Playwright) smoke flow: vendor apply → admin approve → vendor lists a product.
