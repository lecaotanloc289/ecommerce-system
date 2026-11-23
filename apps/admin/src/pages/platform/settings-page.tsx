import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CurrencySchema,
  type Currency,
  type PlatformSettings,
  type PlatformSettingsUpdate,
} from '@repo/core';
import { formatDateTime } from '@repo/i18n';
import { Button, Checkbox, Input, Label, toast } from '@repo/ui';
import { api } from '@/auth/session';
import { ErrorAlert } from '@/components/error-alert';
import { FilterSelect } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { useLocale, type TFunction } from '@/i18n/use-locale';
import { unwrap } from '@/lib/api-error';
import { compact } from '@/lib/compact';
import {
  SETTINGS_BOUNDS,
  settingsToForm,
  validateSettingsForm,
  type IntegerField,
  type SettingsFieldError,
  type SettingsFormErrors,
  type SettingsFormValues,
} from '@/lib/settings-form';
import { useApiMutation } from '@/lib/use-api-mutation';

const SETTINGS_KEY = ['platform', 'settings'] as const;

export function SettingsPage() {
  const { t } = useLocale();
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => unwrap(api.GET('/v1/platform/settings')),
  });
  return (
    <>
      <PageHeader
        title={t('admin.nav.settings')}
        description={t('admin.platform.settings.description')}
      />
      {settings.isError ? <ErrorAlert error={settings.error} /> : null}
      {settings.data ? <SettingsForm settings={settings.data} /> : null}
    </>
  );
}

function errorText(t: TFunction, error: SettingsFieldError): string {
  switch (error.kind) {
    case 'percentInvalid':
      return t('admin.platform.settings.percentInvalid');
    case 'range':
      return t('admin.platform.settings.range', { min: error.min, max: error.max });
    case 'currenciesRequired':
      return t('admin.platform.settings.currenciesRequired');
    case 'defaultNotSupported':
      return t('admin.platform.settings.defaultNotSupported');
  }
}

const INTEGER_FIELDS: readonly {
  field: IntegerField;
  labelKey:
    | 'admin.platform.settings.holdPeriodDays'
    | 'admin.platform.settings.refundWindowDays'
    | 'admin.platform.settings.paymentTimeoutMinutes'
    | 'admin.platform.settings.maxCouponStack';
}[] = [
  { field: 'holdPeriodDays', labelKey: 'admin.platform.settings.holdPeriodDays' },
  { field: 'refundWindowDays', labelKey: 'admin.platform.settings.refundWindowDays' },
  { field: 'paymentTimeoutMinutes', labelKey: 'admin.platform.settings.paymentTimeoutMinutes' },
  { field: 'maxCouponStack', labelKey: 'admin.platform.settings.maxCouponStack' },
];

export function SettingsForm({ settings }: { settings: Omit<PlatformSettings, 'id'> }) {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<SettingsFormValues>(() => settingsToForm(settings));
  const [errors, setErrors] = useState<SettingsFormErrors>({});

  const save = useApiMutation(
    (update: PlatformSettingsUpdate, headers) =>
      unwrap(
        api.PATCH('/v1/platform/settings', {
          body: compact(update),
          params: { header: headers },
        }),
      ),
    {
      onSuccess: async (saved) => {
        await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
        setValues(settingsToForm(saved));
        toast.success(t('admin.platform.settings.saved'));
      },
    },
  );

  function patch(next: Partial<SettingsFormValues>) {
    setValues((current) => ({ ...current, ...next }));
  }

  function toggleCurrency(currency: Currency, checked: boolean) {
    const supportedCurrencies = checked
      ? [...values.supportedCurrencies, currency]
      : values.supportedCurrencies.filter((c) => c !== currency);
    patch({ supportedCurrencies });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = validateSettingsForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    save.mutate(result.update);
  }

  const fieldError = (key: keyof SettingsFormValues) => {
    const error = errors[key];
    return error ? (
      <p role="alert" className="text-body-s text-danger-fg">
        {errorText(t, error)}
      </p>
    ) : null;
  };

  return (
    <form onSubmit={submit} noValidate className="grid max-w-xl gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="commission">{t('admin.platform.settings.commission')}</Label>
        <Input
          id="commission"
          inputMode="decimal"
          value={values.commission}
          invalid={errors.commission !== undefined}
          onChange={(e) => patch({ commission: e.target.value })}
        />
        <p className="text-body-s text-text-muted">{t('admin.platform.settings.commissionHint')}</p>
        {fieldError('commission')}
      </div>

      {INTEGER_FIELDS.map(({ field, labelKey }) => (
        <div key={field} className="grid gap-1.5">
          <Label htmlFor={field}>{t(labelKey)}</Label>
          <Input
            id={field}
            inputMode="numeric"
            value={values[field]}
            min={SETTINGS_BOUNDS[field].min}
            max={SETTINGS_BOUNDS[field].max}
            invalid={errors[field] !== undefined}
            onChange={(e) => patch({ [field]: e.target.value })}
          />
          {fieldError(field)}
        </div>
      ))}

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-body-m font-medium">
          {t('admin.platform.settings.supportedCurrencies')}
        </legend>
        {CurrencySchema.options.map((currency) => (
          <div key={currency} className="flex items-center gap-2">
            <Checkbox
              id={`currency-${currency}`}
              checked={values.supportedCurrencies.includes(currency)}
              onCheckedChange={(checked) => toggleCurrency(currency, checked === true)}
            />
            <Label htmlFor={`currency-${currency}`}>{currency}</Label>
          </div>
        ))}
        {fieldError('supportedCurrencies')}
      </fieldset>

      <div className="grid gap-1.5">
        <FilterSelect
          label={t('admin.platform.settings.defaultCurrency')}
          value={values.defaultCurrency}
          onChange={(e) => {
            const parsed = CurrencySchema.safeParse(e.target.value);
            if (parsed.success) patch({ defaultCurrency: parsed.data });
          }}
        >
          {CurrencySchema.options.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </FilterSelect>
        {fieldError('defaultCurrency')}
      </div>

      {save.isError ? <ErrorAlert error={save.error} /> : null}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={save.isPending}>
          {t('admin.platform.settings.save')}
        </Button>
        <span className="text-body-s text-text-muted">
          {t('admin.platform.settings.updatedAt', {
            date: formatDateTime(settings.updatedAt, locale),
          })}
        </span>
      </div>
    </form>
  );
}
