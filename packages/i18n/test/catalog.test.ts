import { ERROR_CODES, SEASONAL_EVENT_IDS } from '@repo/core';
import { describe, expect, it } from 'vitest';
import { APP_LOCALES } from '../src/locale';
import { errorMessages, messages } from '../src/translator';

/** Flatten a message tree to `{ 'a.b.c': 'text' }`. */
function flatten(tree: object, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      for (const [k, v] of flatten(value, path)) out.set(k, v);
    } else {
      out.set(path, value);
    }
  }
  return out;
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();

describe('message catalogs', () => {
  const en = flatten(messages.en);
  const vi = flatten(messages.vi);

  it('vi and en have exactly the same keys', () => {
    expect([...vi.keys()].sort()).toEqual([...en.keys()].sort());
  });

  it.each(APP_LOCALES)('%s has a non-empty string for every key', (locale) => {
    const empty = [...flatten(messages[locale])].filter(
      ([, v]) => typeof v !== 'string' || v.trim() === '',
    );
    expect(empty.map(([k]) => k)).toEqual([]);
  });

  it('vi uses the same {placeholders} as en for every key', () => {
    const mismatched = [...en].filter(
      ([key, text]) =>
        JSON.stringify(placeholders(String(text))) !==
        JSON.stringify(placeholders(String(vi.get(key)))),
    );
    expect(mismatched.map(([k]) => k)).toEqual([]);
  });
});

describe('error catalogs', () => {
  it.each(APP_LOCALES)('%s translates every core error code', (locale) => {
    const catalog: Readonly<Record<string, string>> = errorMessages[locale];
    const missing = ERROR_CODES.filter((code) => (catalog[code] ?? '').trim() === '');
    expect(missing).toEqual([]);
  });

  it.each(APP_LOCALES)('%s has no codes that core does not define', (locale) => {
    const known = new Set<string>(ERROR_CODES);
    expect(Object.keys(errorMessages[locale]).filter((code) => !known.has(code))).toEqual([]);
  });

  it.each(APP_LOCALES)(
    '%s error messages have no {placeholders} (no params are guaranteed yet)',
    (locale) => {
      const withParams = Object.entries(errorMessages[locale]).filter(
        ([, text]) => placeholders(text).length > 0,
      );
      expect(withParams.map(([code]) => code)).toEqual([]);
    },
  );
});

describe('seasonal event copy', () => {
  it.each(APP_LOCALES)('%s has copy for exactly the events core defines', (locale) => {
    expect(Object.keys(messages[locale].events).sort()).toEqual([...SEASONAL_EVENT_IDS].sort());
  });
});
