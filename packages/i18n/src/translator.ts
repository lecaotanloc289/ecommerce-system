import { ErrorCodeSchema, type ErrorCode, type ErrorParams } from '@repo/core';
import type { AppLocale } from './locale';
import { en, type Messages } from './messages/en';
import { errorsEn, errorsVi, type ErrorMessages } from './messages/errors';
import { vi } from './messages/vi';

export const messages: Readonly<Record<AppLocale, Messages>> = { en, vi };
export const errorMessages: Readonly<Record<AppLocale, ErrorMessages>> = {
  en: errorsEn,
  vi: errorsVi,
};

/** Union of every dot-path leaf key in the message tree, e.g. "nav.home". */
type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown> ? `${K}.${DotPaths<T[K]>}` : K;
}[keyof T & string];

export type MessageKey = DotPaths<Messages>;

export type MessageParams = Readonly<Record<string, string | number>>;

export type TFunction = (key: MessageKey, params?: MessageParams) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Walk a dot path; returns `undefined` unless it lands on a string leaf. */
function resolve(tree: Messages, key: string): string | undefined {
  let node: unknown = tree;
  for (const part of key.split('.')) {
    if (!isRecord(node) || !Object.hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Replace `{name}` with `params.name`; unknown placeholders are left as-is. */
export function interpolate(
  template: string,
  params?: Readonly<Record<string, string | number | boolean>>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

/**
 * Framework-agnostic translator for one locale. A key with no string leaf returns the key
 * itself, so a missing translation is visible in the UI instead of rendering blank.
 */
export function createTranslator(locale: AppLocale): TFunction {
  const tree = messages[locale];
  return (key, params) => interpolate(resolve(tree, key) ?? key, params);
}

const FALLBACK_ERROR_CODE: ErrorCode = 'common.error.internal';

/**
 * Translate an API error (`{ errorCode, params }`, see core `ErrorResponseSchema`).
 * `errorCode` is a plain string because it comes off the network: a server newer than this
 * bundle may send a code it doesn't know, which falls back to the generic internal-error text.
 */
export function translateError(locale: AppLocale, errorCode: string, params?: ErrorParams): string {
  const parsed = ErrorCodeSchema.safeParse(errorCode);
  const code = parsed.success ? parsed.data : FALLBACK_ERROR_CODE;
  return interpolate(errorMessages[locale][code], params);
}
