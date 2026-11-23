'use client';

import * as React from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui';
import { ProfileUpdateSchema } from '@repo/core';
import { fromCoreLocale, toCoreLocale, type AppLocale } from '@repo/i18n';
import { updateProfile } from '@/lib/api/account';
import { describeError } from '@/lib/api/error-message';
import { fieldErrorsOf } from '@/lib/form-errors';
import { newIdempotencyKey } from '@/lib/idempotency';
import { useLocale } from '@/i18n/use-locale';
import { useAuth } from '@/store/auth-provider';
import { TextField } from '../common/text-field';

/** Name + preferred language (`PATCH /v1/me`). The email comes from the OAuth provider and is read-only. */
export function ProfileForm() {
  const { locale, t } = useLocale();
  const { user, refreshUser } = useAuth();
  const [name, setName] = React.useState(user?.name ?? '');
  const [language, setLanguage] = React.useState<AppLocale>(
    user ? fromCoreLocale(user.primaryLocale) : locale,
  );
  const [nameError, setNameError] = React.useState<ReturnType<typeof fieldErrorsOf>['name']>();
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: 'success' | 'danger'; text: string } | null>(
    null,
  );
  // One key per edit: a double click / retry of the same submit replays the first result.
  const keyRef = React.useRef<string | null>(null);

  if (!user) return null;

  const dirtyReset = () => {
    keyRef.current = null;
    setMessage(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = ProfileUpdateSchema.safeParse({
      name,
      primaryLocale: toCoreLocale(language),
    });
    if (!parsed.success) {
      setNameError(fieldErrorsOf(parsed.error, ['name']).name);
      return;
    }
    setNameError(undefined);
    setBusy(true);
    setMessage(null);
    keyRef.current ??= newIdempotencyKey();
    try {
      await updateProfile(parsed.data, keyRef.current);
      keyRef.current = null;
      await refreshUser();
      setMessage({ tone: 'success', text: t('account.saved') });
    } catch (error) {
      setMessage({
        tone: 'danger',
        text: describeError(locale, error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-xl flex-col gap-5" noValidate>
      {user.email ? (
        <div className="flex flex-col gap-1">
          <span className="text-body-s font-medium text-text-body">{t('account.email')}</span>
          <span className="text-body-m text-text-primary">{user.email}</span>
        </div>
      ) : null}
      <TextField
        name="name"
        label={t('account.name')}
        value={name}
        error={nameError}
        autoComplete="name"
        maxLength={120}
        onChange={(e) => {
          setName(e.target.value);
          dirtyReset();
        }}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="primaryLocale">{t('account.language')}</Label>
        <Select
          value={language}
          onValueChange={(value) => {
            setLanguage(value === 'en' ? 'en' : 'vi');
            dirtyReset();
          }}
        >
          <SelectTrigger id="primaryLocale">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vi">{t('account.languageVi')}</SelectItem>
            <SelectItem value="en">{t('account.languageEn')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {message ? (
        <Alert variant={message.tone === 'success' ? 'success' : 'danger'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}
      <div>
        <Button type="submit" loading={busy}>
          {busy ? t('account.saving') : t('account.save')}
        </Button>
      </div>
    </form>
  );
}
