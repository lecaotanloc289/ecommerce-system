/** Deterministic canonical ULIDs for fixtures: `ulid(1)` → `01JDZZ00000000000000000001`. */
export const ulid = (n: number): string => `01JDZZ${String(n).padStart(20, '0')}`;
