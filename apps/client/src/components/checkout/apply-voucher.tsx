'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { Button, Card, Input } from '@repo/ui';
import { useLocale } from '../../i18n/locale-provider';
import { formatMoney } from '../../lib/format';
import { cn } from '../../lib/utils';
import { findVoucher } from '../../mocks/cart';
import { useCheckout, useOrderTotals } from '../../store/checkout-store';
import type { Voucher } from '../../types';

/**
 * Voucher entry card (Parts/Additional/Apply Voucher/001). Validates against the
 * mock voucher table; the applied code lives in the checkout store so every
 * summary reflects it. Server re-validates at checkout once the API exists.
 */
export function ApplyVoucher({ className }: { className?: string }) {
  const { locale, t } = useLocale();
  const { setVoucherCode } = useCheckout();
  const { voucher, totals } = useOrderTotals();
  const [input, setInput] = React.useState('');
  // Stored as data (not translated text) so it re-renders in the current locale.
  const [error, setError] = React.useState<
    { kind: 'invalid' } | { kind: 'minSpend'; voucher: Voucher } | null
  >(null);
  const errorId = React.useId();

  const minSpendText = (v: Voucher) =>
    t('cart.voucherMinSpend', { amount: formatMoney(v.minSubtotal, locale), code: v.code });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const match = findVoucher(input);
    if (!match) {
      setError({ kind: 'invalid' });
      return;
    }
    if (totals.subtotal.amount < match.minSubtotal.amount) {
      setError({ kind: 'minSpend', voucher: match });
      return;
    }
    setError(null);
    setInput('');
    setVoucherCode(match.code);
  };

  const belowMinimum = voucher ? totals.subtotal.amount < voucher.minSubtotal.amount : false;
  const errorText = error
    ? error.kind === 'invalid'
      ? t('cart.voucherInvalid')
      : minSpendText(error.voucher)
    : null;

  return (
    <Card className={cn('flex flex-col gap-3 p-5', className)}>
      <span className="text-body-m font-semibold text-text-primary">{t('cart.haveVoucher')}</span>
      {voucher ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 rounded-md bg-success-bg px-3 py-2 text-body-s font-medium text-success-fg">
            <span>{t('cart.voucherApplied', { code: voucher.code })}</span>
            <button
              type="button"
              onClick={() => setVoucherCode(null)}
              aria-label={t('cart.removeVoucher')}
              className="inline-flex size-6 items-center justify-center rounded-md hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          {belowMinimum ? (
            <p className="text-body-s text-text-muted">{minSpendText(voucher)}</p>
          ) : null}
        </div>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={onSubmit}>
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              aria-label={t('cart.haveVoucher')}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              placeholder={t('cart.voucherPlaceholder')}
              autoComplete="off"
              className="flex-1"
            />
            <Button type="submit" variant="dark" disabled={input.trim() === ''}>
              {t('common.apply')}
            </Button>
          </div>
          {errorText ? (
            <p id={errorId} role="alert" className="text-body-s text-danger-fg">
              {errorText}
            </p>
          ) : null}
        </form>
      )}
    </Card>
  );
}
