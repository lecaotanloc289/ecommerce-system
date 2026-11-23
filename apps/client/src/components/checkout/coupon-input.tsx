'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { Button, Card, Input } from '@repo/ui';
import { useT } from '../../i18n/use-locale';
import { cn } from '../../lib/utils';
import { useCheckout } from '../../store/checkout-store';

/**
 * Voucher codes entered on the review step. They are only collected here: the server resolves,
 * validates and prices them when the order is placed (`coupon.error.*` come back then).
 */
export function CouponInput({ className }: { className?: string }) {
  const t = useT();
  const { choices, addCouponCode, removeCouponCode } = useCheckout();
  const [input, setInput] = React.useState('');
  const [error, setError] = React.useState<'invalid' | 'duplicate' | null>(null);
  const errorId = React.useId();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const result = addCouponCode(input);
    if (result === 'added') {
      setInput('');
      setError(null);
    } else {
      setError(result);
    }
  };

  return (
    <Card className={cn('flex flex-col gap-3 p-5', className)}>
      <span className="text-body-m font-semibold text-text-primary">
        {t('checkout.couponTitle')}
      </span>
      {choices.couponCodes.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {choices.couponCodes.map((code) => (
            <li
              key={code}
              className="inline-flex items-center gap-1 rounded-md bg-success-bg px-3 py-1.5 text-body-s font-medium text-success-fg"
            >
              {code}
              <button
                type="button"
                onClick={() => removeCouponCode(code)}
                aria-label={t('checkout.couponRemove', { code })}
                className="inline-flex size-5 items-center justify-center rounded-md hover:bg-bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="flex flex-col gap-2" onSubmit={onSubmit}>
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            aria-label={t('checkout.couponTitle')}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            placeholder={t('checkout.couponPlaceholder')}
            autoComplete="off"
            className="flex-1"
          />
          <Button type="submit" variant="dark" disabled={input.trim() === ''}>
            {t('checkout.couponAdd')}
          </Button>
        </div>
        {error ? (
          <p id={errorId} role="alert" className="text-body-s text-danger-fg">
            {error === 'invalid' ? t('checkout.couponInvalid') : t('checkout.couponDuplicate')}
          </p>
        ) : null}
        <p className="text-body-s text-text-muted">{t('checkout.couponNote')}</p>
      </form>
    </Card>
  );
}
