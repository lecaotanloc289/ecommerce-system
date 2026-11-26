import type { Currency } from '@repo/core';
import { Input } from '@repo/ui';
import { parseMoneyInput } from '@/lib/money-input';

/**
 * Text field for a price. It keeps the raw text (the parent owns it, parse with
 * `parseMoneyInput` / `moneyFromInput`) and flags it invalid when it is not an exact amount in
 * `currency`. The currency code is shown as a suffix; VND takes no decimals, USD takes cents.
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  id,
  label,
  disabled,
  className,
}: {
  value: string;
  onChange: (text: string) => void;
  currency: Currency;
  id?: string;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const invalid = value.trim() !== '' && parseMoneyInput(value, currency) === null;
  return (
    <div className="relative">
      <Input
        id={id}
        aria-label={label}
        inputMode={currency === 'VND' ? 'numeric' : 'decimal'}
        value={value}
        invalid={invalid}
        disabled={disabled}
        className={className ? `${className} pr-14` : 'pr-14'}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-caption text-text-muted">
        {currency}
      </span>
    </div>
  );
}
