import { readFileSync } from 'node:fs';

/** Raw text of `test/fixtures/<name>.json` (byte-exact, for signature tests). */
export function fixtureText(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
}

export function fixture(name: string): unknown {
  return JSON.parse(fixtureText(name));
}
