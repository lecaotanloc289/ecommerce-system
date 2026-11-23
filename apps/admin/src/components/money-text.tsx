import { formatMoney } from '@repo/i18n';
import type { Money } from '@repo/core';
import { useLocale } from '@/i18n/use-locale';

/** Integer minor-unit money rendered with `formatMoney` (Golden Rule #2); never does arithmetic. */
export function MoneyText({ money }: { money: Money }) {
  const { locale } = useLocale();
  return <span className="tabular-nums">{formatMoney(money, locale)}</span>;
}
