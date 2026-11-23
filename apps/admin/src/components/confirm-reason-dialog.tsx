import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '@repo/ui';
import { ErrorAlert } from '@/components/error-alert';
import { useT } from '@/i18n/use-locale';

export const MAX_REASON_LENGTH = 500;

export interface ConfirmReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** Label of the reason field; defaults to the generic "Reason". */
  reasonLabel?: string;
  destructive?: boolean;
  pending: boolean;
  /** Last mutation error, shown inside the dialog (cleared by the caller on reopen). */
  error?: unknown;
  /** Extra content between the description and the reason field (e.g. a custom error). */
  children?: ReactNode;
  onConfirm: (reason: string) => void;
}

/** Confirm dialog that requires a trimmed 1..500 character reason (suspend, block, reject, refund). */
export function ConfirmReasonDialog(props: ConfirmReasonDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        {/* Remounted per open so the draft never leaks between targets. */}
        {props.open ? <ReasonForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ReasonForm({
  onOpenChange,
  title,
  description,
  confirmLabel,
  reasonLabel,
  destructive,
  pending,
  error,
  children,
  onConfirm,
}: ConfirmReasonDialogProps) {
  const t = useT();
  const inputId = useId();
  const helpId = useId();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const trimmed = reason.trim();
  const problem =
    trimmed === ''
      ? t('admin.platform.common.reasonRequired')
      : trimmed.length > MAX_REASON_LENGTH
        ? t('admin.platform.common.reasonTooLong')
        : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (problem === null) onConfirm(trimmed);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      {children}
      <div className="grid gap-1.5">
        <Label htmlFor={inputId}>{reasonLabel ?? t('admin.platform.common.reason')}</Label>
        <Textarea
          id={inputId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          aria-invalid={touched && problem !== null}
          aria-describedby={helpId}
        />
        <p
          id={helpId}
          role={touched && problem ? 'alert' : undefined}
          className={
            touched && problem ? 'text-body-s text-danger-fg' : 'text-body-s text-text-muted'
          }
        >
          {touched && problem ? problem : t('admin.platform.common.reasonHint')}
        </p>
      </div>
      {error ? <ErrorAlert error={error} /> : null}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          {t('admin.platform.common.cancel')}
        </Button>
        <Button type="submit" variant={destructive ? 'destructive' : 'primary'} loading={pending}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
