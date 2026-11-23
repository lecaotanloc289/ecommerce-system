// Where to land after OAuth. The provider round-trip reloads the SPA, so the deep link the user
// asked for (`/platform/settings`) survives it in sessionStorage. A path is not sensitive; tokens
// never go to storage (Golden Rule #5).

const KEY = 'admin.returnTo';
const AUTH_PATHS = ['/login', '/auth/callback'];

/** Same-origin absolute path only (blocks `//evil.com`, `/\evil.com`, full URLs). */
export function isSafeReturnPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return false;
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

export function readReturnPath(): string {
  try {
    const path = sessionStorage.getItem(KEY);
    return path !== null && isSafeReturnPath(path) ? path : '/';
  } catch {
    return '/';
  }
}
