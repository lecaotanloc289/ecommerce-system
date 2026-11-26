// Where to land after OAuth. The provider round-trip reloads the SPA, so the deep link the user
// asked for (`/platform/settings`) survives it in sessionStorage. A path is not sensitive; tokens
// never go to storage (Golden Rule #5).

const KEY = 'admin.returnTo';
const AUTH_PATHS = ['/login', '/auth/callback'];

/**
 * Same-origin absolute path only: blocks `//evil.com`, full URLs, and backslashes / control
 * characters anywhere (browsers strip tabs/newlines, so `/\t/evil.com` would become `//evil.com`).
 */
export function isSafeReturnPath(path: string): boolean {
  // A loop rather than a regex: a control-character class trips ESLint's no-control-regex.
  for (const char of path) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === '\\') return false;
  }
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  const pathname = path.split(/[?#]/, 1)[0] ?? '';
  return !AUTH_PATHS.includes(pathname);
}

export function saveReturnPath(path: string): void {
  try {
    sessionStorage.setItem(KEY, isSafeReturnPath(path) ? path : '/');
  } catch {
    // Storage blocked: the user lands on `/` instead.
  }
}

/** Forget the saved path once used, so a later sign-in in this tab does not land on it. */
export function clearReturnPath(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: nothing was saved.
  }
}

export function readReturnPath(): string {
  try {
    const path = sessionStorage.getItem(KEY);
    return path !== null && isSafeReturnPath(path) ? path : '/';
  } catch {
    return '/';
  }
}
