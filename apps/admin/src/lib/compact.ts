type Compact<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Drops `undefined` properties. The SDK's generated types use `exactOptionalPropertyTypes`
 * (`status?: 'PENDING'`, not `status?: 'PENDING' | undefined`), so an unset filter must be absent
 * from the query object rather than present as `undefined`.
 */
export function compact<T extends object>(source: T): Compact<T> {
  const result: Compact<T> = {};
  for (const key of Object.keys(source)) {
    if (!isKeyOf(source, key)) continue;
    const value = source[key];
    if (value !== undefined) Object.assign(result, { [key]: value });
  }
  return result;
}

function isKeyOf<T extends object>(source: T, key: string): key is Extract<keyof T, string> {
  return Object.hasOwn(source, key);
}
