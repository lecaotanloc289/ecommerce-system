# @repo/i18n

UI text and formatting for web + admin (Golden Rule #7). Framework-agnostic TypeScript: no React,
no next-intl. React glue (`useT` / `useLocale`) lives in each app — see `apps/client/src/i18n/use-locale.ts`
and `apps/admin/src/i18n/use-locale.ts`. Admin text lives under the `admin.*` namespace.
Depends on `@repo/core` (Money, Locale, ErrorCode types); never on apps or server.

## Layout

| File                     | What                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `src/messages/en.ts`     | English catalog — **the shape source**. `Messages` type is derived from it.            |
| `src/messages/vi.ts`     | Vietnamese catalog, typed `Messages` (a missing/extra key is a compile error).         |
| `src/messages/errors.ts` | `errorsEn` / `errorsVi`: `Record<ErrorCode, string>` for every core error code.        |
| `src/translator.ts`      | `MessageKey` (dot paths), `createTranslator(locale)`, `interpolate`, `translateError`. |
| `src/format.ts`          | `formatMoney`, `formatDate` (fixed `Asia/Ho_Chi_Minh`), `formatCompact`.               |
| `src/locale.ts`          | `AppLocale`, `DEFAULT_LOCALE`, `isAppLocale`, `toCoreLocale` / `fromCoreLocale`.       |

Root export only (`@repo/i18n`), built by tsup to `dist/`.

## Rules

- **Locale casing:** UI code uses `AppLocale` = `'vi' | 'en'` (BCP 47, matches `<html lang>`, storage,
  next-intl). `@repo/core` `Locale` = `'VI' | 'EN'` mirrors Prisma and is only for persisted values
  (`User.primaryLocale`). Convert at that boundary with `toCoreLocale` / `fromCoreLocale`.
- **Adding text:** add the key to `en.ts`, then `vi.ts` (the compiler forces it). Interpolate with
  `{name}` placeholders; `test/catalog.test.ts` fails if vi and en use different placeholders.
- **Error codes:** a new code in core's `ERROR_CODES` must get a message in both `errorsEn` and
  `errorsVi` (compile error + test). Error messages carry no `{params}` until the server guarantees them.
- **Missing keys:** `t()` returns the key itself, so a gap is visible rather than blank.
- **Money:** `formatMoney` takes core `Money` (integer minor units), throws on non-integers, and divides
  USD cents by 100 only at the `Intl` boundary. Do money math with `@repo/core/money`, not here.
- Existing catalog keys are camelCase leaves (`common.addToCart`); keep that style within the tree.

## Commands

- `pnpm --filter @repo/i18n typecheck` — `tsc` for `src/` and `test/`
- `pnpm --filter @repo/i18n test` — Vitest (needs `@repo/core` built)
- `pnpm --filter @repo/i18n build` — tsup → `dist/` (ESM + CJS + d.ts)
