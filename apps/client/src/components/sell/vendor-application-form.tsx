'use client';

import * as React from 'react';
import { Alert, AlertDescription, Button } from '@repo/ui';
import { submitVendorApplication } from '@/lib/api/account';
import { describeError, errorCodeOfThrown } from '@/lib/api/error-message';
import type { FieldErrors } from '@/lib/form-errors';
import { newIdempotencyKey } from '@/lib/idempotency';
import {
  EMPTY_APPLICATION_FORM,
  validateApplication,
  type ApplicationField,
  type ApplicationFormValues,
} from '@/lib/vendor-application';
import { useLocale } from '@/i18n/use-locale';
import { TextField } from '../common/text-field';
import { KycFileField } from './kyc-file-field';

/**
 * Seller application (`POST /v1/vendor-applications`): two KYC documents uploaded through
 * presigned URLs, tax / national ID numbers and bank details, validated with the core schema.
 * `onSubmitted` fires after the API stored it (also when one was already pending, so the
 * parent re-reads the real status).
 */
export function VendorApplicationForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { locale, t } = useLocale();
  const [values, setValues] = React.useState<ApplicationFormValues>(EMPTY_APPLICATION_FORM);
  const [errors, setErrors] = React.useState<FieldErrors<ApplicationField>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // One key per user action: retrying the same submit replays the first response.
  const keyRef = React.useRef<string | null>(null);

  const set = (field: keyof ApplicationFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    keyRef.current = null;
  };

  const text = (
    field: 'taxId' | 'nationalIdNumber' | 'bankName' | 'bankAccountNumber' | 'accountHolder',
    label: Parameters<typeof t>[0],
    extra?: { inputMode?: 'numeric' | 'text'; autoComplete?: string },
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
    const checked = validateApplication(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      if (checked.errors.nationalIdKey === 'form.invalid' && values.nationalIdKey) {
        setServerError(t('sell.sameFile'));
      }
      return;
    }
    setErrors({});
    setBusy(true);
    keyRef.current ??= newIdempotencyKey();
    try {
      await submitVendorApplication(checked.value, keyRef.current);
      onSubmitted();
    } catch (error) {
      const code = errorCodeOfThrown(error);
      if (code === 'vendor.error.application-already-pending') {
        // Another tab / an earlier submit got through: show the real status.
        onSubmitted();
        return;
      }
      setServerError(
        code === 'common.error.conflict' ? t('sell.alreadyVendor') : describeError(locale, error),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
      <p className="text-body-s text-text-muted">{t('sell.kycNote')}</p>
      <div className="grid gap-5 sm:grid-cols-2">
        <KycFileField
          label={t('sell.businessLicense')}
          error={errors.businessLicenseKey}
          onKey={(key) => set('businessLicenseKey', key)}
        />
        <KycFileField
          label={t('sell.nationalIdFile')}
          error={errors.nationalIdKey}
          onKey={(key) => set('nationalIdKey', key)}
        />
        {text('taxId', 'sell.taxId')}
        {text('nationalIdNumber', 'sell.nationalIdNumber')}
        {text('bankName', 'sell.bankName')}
        {text('bankAccountNumber', 'sell.bankAccountNumber', { inputMode: 'numeric' })}
        {text('accountHolder', 'sell.accountHolder', { autoComplete: 'name' })}
      </div>
      {serverError ? (
        <Alert variant="danger">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <Button type="submit" size="lg" loading={busy}>
          {busy ? t('sell.submitting') : t('sell.submit')}
        </Button>
      </div>
    </form>
  );
}
