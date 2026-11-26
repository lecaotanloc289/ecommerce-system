import {
  VendorApplicationCreateSchema,
  type VendorApplication,
  type VendorApplicationCreate,
  type VendorApplicationMe,
} from '@repo/core';
import { fieldErrorsOf, type FieldErrors } from './form-errors';

/** What `/sell` shows for the current user. */
export type ApplicationView =
  | { kind: 'none'; history: VendorApplication[] }
  | { kind: 'pending'; application: VendorApplication; history: VendorApplication[] }
  | { kind: 'approved'; application: VendorApplication; history: VendorApplication[] }
  | { kind: 'rejected'; application: VendorApplication; history: VendorApplication[] };

/** Map `GET /v1/vendor-applications/me` to a view; `history` excludes the `latest` row. */
export function applicationView(me: VendorApplicationMe): ApplicationView {
  const latest = me.latest;
  const older = me.history.filter((a) => a.id !== latest?.id);
  if (!latest) return { kind: 'none', history: older };
  switch (latest.status) {
    case 'PENDING':
      return { kind: 'pending', application: latest, history: older };
    case 'APPROVED':
      return { kind: 'approved', application: latest, history: older };
    case 'REJECTED':
      return { kind: 'rejected', application: latest, history: older };
  }
}

/** The form can be shown when there is no application yet or the last one was rejected. */
export function canApply(view: ApplicationView): boolean {
  return view.kind === 'none' || view.kind === 'rejected';
}

export const APPLICATION_TEXT_FIELDS = [
  'taxId',
  'nationalIdNumber',
  'bankName',
  'bankAccountNumber',
  'accountHolder',
] as const;
export const APPLICATION_FIELDS = [
  'businessLicenseKey',
  'nationalIdKey',
  ...APPLICATION_TEXT_FIELDS,
] as const;
export type ApplicationField = (typeof APPLICATION_FIELDS)[number];

export interface ApplicationFormValues {
  taxId: string;
  nationalIdNumber: string;
  bankName: string;
  bankAccountNumber: string;
  accountHolder: string;
  /** Upload keys from presign; empty until the file is uploaded. */
  businessLicenseKey: string;
  nationalIdKey: string;
}

export const EMPTY_APPLICATION_FORM: ApplicationFormValues = {
  taxId: '',
  nationalIdNumber: '',
  bankName: '',
  bankAccountNumber: '',
  accountHolder: '',
  businessLicenseKey: '',
  nationalIdKey: '',
};

export type ApplicationValidation =
  | { ok: true; value: VendorApplicationCreate }
  | { ok: false; errors: FieldErrors<ApplicationField> };

/** Validate with the core schema; the two document keys must be present and different. */
export function validateApplication(values: ApplicationFormValues): ApplicationValidation {
  const parsed = VendorApplicationCreateSchema.safeParse(values);
  if (!parsed.success)
    return { ok: false, errors: fieldErrorsOf(parsed.error, APPLICATION_FIELDS) };
  if (parsed.data.businessLicenseKey === parsed.data.nationalIdKey) {
    return { ok: false, errors: { nationalIdKey: 'form.invalid' } };
  }
  return { ok: true, value: parsed.data };
}
