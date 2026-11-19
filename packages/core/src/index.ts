// Domain layer: Zod schemas, derived types, enums, error codes,
// Money utility, ID brands, shared constants.
// MUST NOT import from apps/*, server/* or @repo/db — see CLAUDE.md §3 dependency rules.
import * as MoneyOps from './money';
import type { Money as MoneyShape } from './schemas/money';

export * from './enums';
export * from './ids';
export * from './errors';
export * from './schemas';

// Money helpers are namespaced (`Money.of`, `Money.add`, `Money.allocate`, …) so generic
// names like `add` / `sum` / `zero` don't pollute consumers' scope. Value + type share the
// name, like the enums: `const m: Money = Money.of(100, 'VND')`.
export const Money = MoneyOps;
export type Money = MoneyShape;
export { BPS_DENOMINATOR, type RoundingMode } from './money';
