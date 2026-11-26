/** Commission is stored as integer basis points (1 bp = 0.01 %); the form shows percent. */

const MAX_BPS = 10_000;

/** `250` → `"2.5"`, `1000` → `"10"`, `5` → `"0.05"`. Integer arithmetic only, no float division. */
export function bpsToPercent(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_BPS) {
    throw new RangeError(`bps must be an integer in 0..${MAX_BPS}, got ${bps}`);
  }
  const whole = Math.trunc(bps / 100);
  const fraction = String(bps % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${whole}.${fraction}`;
}

const PERCENT_PATTERN = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

/**
 * `"2.5"` / `"2,5"` → `250`. Returns `null` for anything that is not a percentage in 0..100 with
 * at most 2 decimals (so the result is always an exact integer of basis points).
 */
export function percentToBps(text: string): number | null {
  const match = PERCENT_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, whole = '', fraction = ''] = match;
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return bps <= MAX_BPS ? bps : null;
}
