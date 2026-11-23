'use client';

import * as React from 'react';
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui';
import { AddressInputSchema, type AddressInput } from '@repo/core';
import { useLocale, type MessageKey } from '../../i18n/use-locale';
import { cn } from '../../lib/utils';

/** ISO 3166-1 alpha-2; display names come from Intl so they follow the locale. */
const COUNTRY_CODES = ['VN', 'US', 'SG', 'JP', 'DE'] as const;

type TextField = 'recipientName' | 'phone' | 'line1' | 'line2' | 'ward' | 'district' | 'city';

const FIELDS: { name: TextField; label: MessageKey; wide?: boolean; type?: string }[] = [
  { name: 'recipientName', label: 'addressForm.recipientName' },
  { name: 'phone', label: 'addressForm.phone', type: 'tel' },
  { name: 'line1', label: 'addressForm.line1', wide: true },
  { name: 'line2', label: 'addressForm.line2', wide: true },
  { name: 'ward', label: 'addressForm.ward' },
  { name: 'district', label: 'addressForm.district' },
  { name: 'city', label: 'addressForm.city' },
];

interface FormValues {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string;
  ward: string;
  district: string;
  city: string;
  country: string;
  isDefault: boolean;
}

const EMPTY: FormValues = {
  recipientName: '',
  phone: '',
  line1: '',
  line2: '',
  ward: '',
  district: '',
  city: '',
  country: 'VN',
  isDefault: false,
};

type FieldErrors = Partial<Record<TextField | 'country', MessageKey>>;

/**
 * Validate the form against the core `AddressInputSchema` (the same schema the API parses).
 * Returns the parsed input or per-field translated-key errors (schema texts are English, so we
 * map issues to catalog keys instead of showing them).
 */
export function validateAddress(
  values: FormValues,
): { ok: true; data: AddressInput } | { ok: false; errors: FieldErrors } {
  const parsed = AddressInputSchema.safeParse(values);
  if (parsed.success) return { ok: true, data: parsed.data };
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field !== 'string' || !(field === 'country' || FIELDS.some((f) => f.name === field)))
      continue;
    const key = field as TextField | 'country';
    if (errors[key]) continue;
    errors[key] =
      key === 'phone'
        ? 'addressForm.error.phone'
        : issue.code === 'too_big'
          ? 'addressForm.error.tooLong'
          : 'addressForm.error.required';
  }
  return { ok: false, errors };
}

/**
 * Customer address form (shared by checkout and the account address book). Controlled state +
 * the core schema — no form library. `onSubmit` receives the parsed `AddressInput`; the caller
 * does the API call and passes `submitting` / `error`.
 */
export function AddressForm({
  onSubmit,
  onCancel,
  submitting = false,
  error = null,
  showDefaultToggle = true,
  className,
}: {
  onSubmit: (input: AddressInput) => void | Promise<void>;
  onCancel?: () => void;
  submitting?: boolean;
  error?: string | null;
  showDefaultToggle?: boolean;
  className?: string;
}) {
  const { locale, t } = useLocale();
  const [values, setValues] = React.useState<FormValues>(EMPTY);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const idPrefix = React.useId();
  const regionNames = new Intl.DisplayNames([locale === 'vi' ? 'vi-VN' : 'en-US'], {
    type: 'region',
  });

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const result = validateAddress(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    void onSubmit(result.data);
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className={cn('grid gap-4 sm:grid-cols-2', className)}
      aria-busy={submitting}
    >
      {FIELDS.map((f) => {
        const id = `${idPrefix}-${f.name}`;
        const errorKey = errors[f.name];
        return (
          <div key={f.name} className={cn('flex flex-col gap-1.5', f.wide && 'sm:col-span-2')}>
            <Label htmlFor={id}>{t(f.label)}</Label>
            <Input
              id={id}
              name={f.name}
              type={f.type ?? 'text'}
              value={values[f.name]}
              invalid={errorKey ? true : undefined}
              aria-invalid={errorKey ? true : undefined}
              aria-describedby={errorKey ? `${id}-error` : undefined}
              onChange={(e) => set(f.name, e.target.value)}
            />
            {errorKey ? (
              <p id={`${id}-error`} className="text-body-s text-danger-fg">
                {t(errorKey)}
              </p>
            ) : null}
          </div>
        );
      })}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-country`}>{t('addressForm.country')}</Label>
        <Select value={values.country} onValueChange={(v) => set('country', v)}>
          <SelectTrigger id={`${idPrefix}-country`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COUNTRY_CODES.map((c) => (
              <SelectItem key={c} value={c}>
                {regionNames.of(c) ?? c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showDefaultToggle ? (
        <label className="flex items-center gap-2.5 text-body-m text-text-body sm:col-span-2">
          <Checkbox
            checked={values.isDefault}
            onCheckedChange={(checked) => set('isDefault', checked === true)}
          />
          {t('addressForm.isDefault')}
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-body-s text-danger-fg sm:col-span-2">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3 sm:col-span-2">
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            {t('addressForm.cancel')}
          </Button>
        ) : null}
        <Button type="submit" disabled={submitting}>
          {submitting ? t('addressForm.saving') : t('addressForm.submit')}
        </Button>
      </div>
    </form>
  );
}
