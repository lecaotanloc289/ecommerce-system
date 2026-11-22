'use client';

import {
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@repo/ui';
import { useLocale } from '../../i18n/use-locale';
import { cn } from '../../lib/utils';

/** ISO 3166-1 alpha-2; display names come from Intl so they follow the locale. */
const countryCodes = ['VN', 'US', 'SG', 'JP', 'DE'] as const;

/**
 * Customer / shipping address form (Parts/Chekout/Form/Add Customer data).
 * Visual only until `@repo/core` schemas + react-hook-form wiring land.
 */
export function AddressForm({ className }: { className?: string }) {
  const { locale, t } = useLocale();
  const regionNames = new Intl.DisplayNames([locale === 'vi' ? 'vi-VN' : 'en-US'], {
    type: 'region',
  });
  return (
    <form
      className={cn('grid gap-4 sm:grid-cols-2', className)}
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="firstName">{t('checkout.firstName')}</Label>
        <Input id="firstName" name="firstName" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lastName">{t('checkout.lastName')}</Label>
        <Input id="lastName" name="lastName" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">{t('checkout.email')}</Label>
        <Input id="email" name="email" type="email" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">{t('checkout.phone')}</Label>
        <Input id="phone" name="phone" type="tel" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="country">{t('checkout.country')}</Label>
        <Select defaultValue="VN">
          <SelectTrigger id="country">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {countryCodes.map((c) => (
              <SelectItem key={c} value={c}>
                {regionNames.of(c) ?? c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="city">{t('checkout.city')}</Label>
          <Input id="city" name="city" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="postal">{t('checkout.postal')}</Label>
          <Input id="postal" name="postal" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="address">{t('checkout.address')}</Label>
        <Textarea id="address" name="address" rows={2} />
      </div>
      <label className="flex items-center gap-2.5 text-body-m text-text-body sm:col-span-2">
        <Checkbox id="saveAddress" defaultChecked />
        {t('checkout.saveAddress')}
      </label>
    </form>
  );
}
