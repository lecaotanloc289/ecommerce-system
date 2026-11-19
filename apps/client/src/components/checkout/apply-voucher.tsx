'use client';

import { Button, Card, Input } from '@repo/ui';
import { useT } from '../../i18n/locale-provider';
import { cn } from '../../lib/utils';

/** Voucher entry card (Parts/Additional/Apply Voucher/001). */
export function ApplyVoucher({ className }: { className?: string }) {
  const t = useT();
  return (
    <Card className={cn('flex flex-col gap-3 p-5', className)}>
      <span className="text-body-m font-semibold text-text-primary">{t('cart.haveVoucher')}</span>
      <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
        <Input
          aria-label={t('cart.haveVoucher')}
          placeholder={t('cart.voucherPlaceholder')}
          className="flex-1"
        />
        <Button type="submit" variant="dark">
          {t('common.apply')}
        </Button>
      </form>
    </Card>
  );
}
