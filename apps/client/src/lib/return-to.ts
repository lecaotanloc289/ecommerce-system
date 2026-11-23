import { APP_LOCALES } from '@repo/i18n';

/** Pages that must never be the post-login destination (would loop or make no sense). */
const AUTH_PATHS = ['/sign-in', '/register', '/auth/callback'];

/**
 * A locale-less, same-origin path to return to after OAuth, or null. Rejects absolute and
 * protocol-relative URLs (`//evil.com`, `/\evil.com`) — the value comes from the query string,
 * so this is an open-redirect guard — and the auth pages themselves.
 */
export function sanitizeReturnTo(value: string | null | undefined): string | null {
  if (!value || value.length > 2000) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (/[\u0000-\u001f]/.test(value)) return null;
  // Locale-aware navigation adds the prefix itself, so drop one already present (`/vi/cart`).
  const localeMatch = new RegExp(`^/(?:${APP_LOCALES.join('|')})(?=$|[/?#])`).exec(value);
  const stripped = localeMatch ? value.slice(localeMatch[0].length) : value;
  const unprefixed = stripped.startsWith('/') ? stripped : `/${stripped}`;
  if (unprefixed.startsWith('//') || unprefixed.startsWith('/\\')) return null;
  const path = unprefixed.split(/[?#]/)[0] ?? '';
  if (AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return unprefixed;
}

/** sessionStorage key for the post-login destination (a path only — never a token). */
export const RETURN_TO_KEY = 'auth-return-to';

export function saveReturnTo(value: string | null | undefined): void {
  const safe = sanitizeReturnTo(value);
  try {
    if (safe) window.sessionStorage.setItem(RETURN_TO_KEY, safe);
    else window.sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    // Storage blocked: the callback falls back to the home page.
  }
}

/** Read and clear the saved destination; `/` when none (or tampered with). */
export function consumeReturnTo(): string {
  try {
    const value = window.sessionStorage.getItem(RETURN_TO_KEY);
    window.sessionStorage.removeItem(RETURN_TO_KEY);
    return sanitizeReturnTo(value) ?? '/';
  } catch {
    return '/';
  }
}
