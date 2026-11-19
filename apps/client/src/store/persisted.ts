'use client';

/**
 * Best-effort Web Storage helpers. Storage can be unavailable (private mode,
 * blocked site data) — reads fall back to `undefined`, writes are dropped.
 */
export function readStored(storage: 'local' | 'session', key: string): unknown {
  try {
    const raw = (storage === 'local' ? window.localStorage : window.sessionStorage).getItem(key);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeStored(storage: 'local' | 'session', key: string, value: unknown): void {
  try {
    (storage === 'local' ? window.localStorage : window.sessionStorage).setItem(
      key,
      JSON.stringify(value),
    );
  } catch {
    // Storage full or blocked: state still works in memory for this tab.
  }
}
