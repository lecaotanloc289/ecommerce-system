'use client';

import * as React from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui';
import type { Address } from '@repo/core';
import { createAddress, updateAddress } from '@/lib/api/account';
import { describeError } from '@/lib/api/error-message';
import {
  addressToFormValues,
  EMPTY_ADDRESS_FORM,
  validateAddressEdit,
  validateNewAddress,
  type AddressField,
  type AddressFormValues,
} from '@/lib/addresses';
import type { FieldErrors } from '@/lib/form-errors';
import { newIdempotencyKey } from '@/lib/idempotency';
import { useLocale } from '@/i18n/use-locale';
import { cn } from '@/lib/utils';
import { TextField } from '../common/text-field';

/** ISO 3166-1 alpha-2; display names come from Intl so they follow the locale. */
const COUNTRY_CODES = ['VN', 'US', 'SG', 'JP', 'DE'] as const;

/**
 * Customer address form for `POST /v1/me/addresses` (no `initial`) or `PATCH …/:id` (`initial`).
 * Validated with the core `AddressInput` / `AddressUpdate` schemas before any request; server
 * errors are shown translated. Reusable from checkout: it persists the address itself and
 * reports the stored row through `onSaved`.
 */
export function AddressForm({
  initial,
  onSaved,
  onCancel,
  className,
}: {
  initial?: Address;
  onSaved: (address: Address) => void;
  onCancel?: () => void;
  className?: string;
}) {
  const { locale, t } = useLocale();
  const [values, setValues] = React.useState<AddressFormValues>(() =>
    initial ? addressToFormValues(initial) : EMPTY_ADDRESS_FORM,
  );
  const [errors, setErrors] = React.useState<FieldErrors<AddressField>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // One key per form state: retrying an unchanged submit replays the first response.
  const keyRef = React.useRef<string | null>(null);

  const regionNames = React.useMemo(
    () => new Intl.DisplayNames([locale === 'vi' ? 'vi-VN' : 'en-US'], { type: 'region' }),
    [locale],
  );

  // An existing address may use a country outside the short list: keep it selectable.
  const countryOptions: readonly string[] = COUNTRY_CODES.includes(
    values.country as (typeof COUNTRY_CODES)[number],
  )
    ? COUNTRY_CODES
    : [values.country, ...COUNTRY_CODES];

  const set = <K extends keyof AddressFormValues>(field: K, value: AddressFormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    keyRef.current = null;
  };

  const text = (
    field: Exclude<AddressField, 'country'>,
    label: Parameters<typeof t>[0],
    extra?: {
      type?: string;
      autoComplete?: string;
      className?: string;
    },
  ) => (
    <TextField
      name={field}
      label={t(label)}
      value={values[field]}
      error={errors[field]}
      onChange={(e) => set(field, e.target.value)}
      {...extra}
    />
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setServerError(null);
    try {
      if (initial) {
        const checked = validateAddressEdit(initial, values);
        if (!checked.ok) return setErrors(checked.errors);
        setErrors({});
        if (checked.value === null) return onSaved(initial);
        setBusy(true);
        keyRef.current ??= newIdempotencyKey();
        onSaved(await updateAddress(initial.id, checked.value, keyRef.current));
      } else {
        const checked = validateNewAddress(values);
        if (!checked.ok) return setErrors(checked.errors);
        setErrors({});
        setBusy(true);
        keyRef.current ??= newIdempotencyKey();
        onSaved(await createAddress(checked.value, keyRef.current));
      }
    } catch (error) {
      setServerError(describeError(locale, error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      className={cn('grid gap-4 sm:grid-cols-2', className)}
    >
      {text('recipientName', 'addr.recipientName', { autoComplete: 'name' })}
      {text('phone', 'addr.phone', { type: 'tel', autoComplete: 'tel' })}
      {text('line1', 'addr.line1', {
        autoComplete: 'address-line1',
        className: 'sm:col-span-2',
      })}
      {text('line2', 'addr.line2', {
        autoComplete: 'address-line2',
        className: 'sm:col-span-2',
      })}
      {text('ward', 'addr.ward')}
      {text('district', 'addr.district')}
      {text('city', 'addr.city', { autoComplete: 'address-level1' })}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address-country">{t('addr.country')}</Label>
        <Select value={values.country} onValueChange={(v) => set('country', v)}>
          <SelectTrigger id="address-country">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {countryOptions.map((c) => (
              <SelectItem key={c} value={c}>
                {regionNames.of(c) ?? c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {initial ? null : (
        <label className="flex items-center gap-2.5 text-body-m text-text-body sm:col-span-2">
          <Checkbox
            checked={values.isDefault}
            onCheckedChange={(checked) => set('isDefault', checked === true)}
          />
          {t('addr.makeDefault')}
        </label>
      )}
      {serverError ? (
        <Alert variant="danger" className="sm:col-span-2">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex gap-3 sm:col-span-2">
        <Button type="submit" loading={busy}>
          {busy ? t('addr.saving') : t('addr.save')}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {t('addr.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
