'use client';

import * as React from 'react';
import { Label } from '@repo/ui';
import type { FieldErrorKey } from '@/lib/form-errors';
import { browserUploadDeps } from '@/lib/api/account';
import { describeError } from '@/lib/api/error-message';
import {
  KYC_ACCEPT,
  UploadError,
  checkKycFile,
  uploadKycFile,
  type FileProblem,
} from '@/lib/uploads';
import { useLocale, type MessageKey } from '@/i18n/use-locale';

const PROBLEM_KEY: Record<FileProblem, MessageKey> = {
  type: 'sell.fileTypeNotAllowed',
  size: 'sell.fileTooLarge',
  empty: 'sell.fileRequired',
};

type State =
  | { status: 'idle' }
  | { status: 'uploading'; name: string; percent: number }
  | { status: 'done'; name: string }
  | { status: 'error'; message: string };

/**
 * One KYC document: validates type/size locally, then presign → PUT with a progress bar, and
 * reports the storage `key` (or '' while there is no valid upload) through `onKey`.
 */
export function KycFileField({
  label,
  error,
  onKey,
}: {
  label: string;
  /** Form-level problem (e.g. the file is required). */
  error?: FieldErrorKey | undefined;
  onKey: (key: string) => void;
}) {
  const { locale, t } = useLocale();
  const id = React.useId();
  const [state, setState] = React.useState<State>({ status: 'idle' });
  // A newer pick supersedes an upload still in flight.
  const attempt = React.useRef(0);

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const mine = ++attempt.current;
    onKey('');
    const problem = checkKycFile(file);
    if (problem) {
      setState({ status: 'error', message: t(PROBLEM_KEY[problem]) });
      return;
    }
    setState({ status: 'uploading', name: file.name, percent: 0 });
    try {
      const key = await uploadKycFile(file, browserUploadDeps, (fraction) => {
        if (attempt.current === mine) {
          setState({ status: 'uploading', name: file.name, percent: Math.round(fraction * 100) });
        }
      });
      if (attempt.current !== mine) return;
      setState({ status: 'done', name: file.name });
      onKey(key);
    } catch (cause) {
      if (attempt.current !== mine) return;
      const message =
        cause instanceof UploadError
          ? t(cause.problem ? PROBLEM_KEY[cause.problem] : 'sell.uploadFailed')
          : describeError(locale, cause);
      setState({ status: 'error', message });
    }
  };

  const shownError =
    state.status === 'error'
      ? state.message
      : error
        ? t(error === 'form.invalid' ? 'sell.sameFile' : 'sell.fileRequired')
        : null;
  const uploading = state.status === 'uploading';

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        type="file"
        accept={KYC_ACCEPT}
        disabled={uploading}
        onChange={(e) => void pick(e)}
        aria-invalid={shownError !== null || undefined}
        aria-describedby={`${id}-hint`}
        className="block w-full text-body-s text-text-body file:mr-3 file:rounded-md file:border file:border-border-default file:bg-bg-elevated file:px-3 file:py-2 file:text-body-s file:font-semibold file:text-text-primary hover:file:bg-bg-muted"
      />
      <p id={`${id}-hint`} className="text-body-s text-text-muted">
        {t('sell.fileHint')}
      </p>
      {state.status === 'uploading' ? (
        <div className="flex flex-col gap-1" role="status">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state.percent}
            aria-label={t('sell.uploadProgress', { percent: state.percent })}
            className="h-2 overflow-hidden rounded-full bg-bg-muted"
          >
            <div
              className="h-full rounded-full bg-brand-solid transition-[width]"
              style={{ width: `${state.percent}%` }}
            />
          </div>
          <span className="text-body-s text-text-muted">
            {t('sell.uploadProgress', { percent: state.percent })}
          </span>
        </div>
      ) : null}
      {state.status === 'done' ? (
        <p className="flex items-center gap-2 text-body-s text-success-fg">
          {t('sell.uploaded', { name: state.name })}
        </p>
      ) : null}
      {shownError ? (
        <p role="alert" className="text-body-s text-danger-fg">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
