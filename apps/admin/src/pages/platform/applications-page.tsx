import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ApplicationStatusSchema, SlugSchema } from '@repo/core';
import { formatDate } from '@repo/i18n';
import {
  Button,
  buttonVariants,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@repo/ui';
import { api } from '@/auth/session';
import { ConfirmReasonDialog } from '@/components/confirm-reason-dialog';
import { CursorTable, type Column } from '@/components/cursor-table';
import { ErrorAlert } from '@/components/error-alert';
import { FilterBar, FilterSelect } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { useLocale } from '@/i18n/use-locale';
import { ApiError, unwrap } from '@/lib/api-error';
import { compact } from '@/lib/compact';
import { suggestSlug } from '@/lib/slug';
import { useApiMutation } from '@/lib/use-api-mutation';
import { useCursorList } from '@/lib/use-cursor-list';

type ListItem = {
  id: string;
  applicantName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  taxIdMasked: string;
  nationalIdNumberMasked: string;
  bankName: string;
  bankAccountNumberMasked: string;
  createdAt: string;
};

const APPLICATIONS_KEY = ['platform', 'applications'] as const;

export function ApplicationsPage() {
  const { t, locale } = useLocale();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<string>('');
  const parsedStatus = ApplicationStatusSchema.safeParse(status).data;
  const openId = params.get('id');

  const list = useCursorList<ListItem>([...APPLICATIONS_KEY, 'list', parsedStatus], (cursor) =>
    unwrap(
      api.GET('/v1/platform/vendor-applications', {
        params: { query: compact({ status: parsedStatus, cursor, limit: 20 }) },
      }),
    ),
  );

  const columns: Column<ListItem>[] = [
    { header: t('admin.platform.applications.applicant'), cell: (r) => r.applicantName },
    { header: t('admin.platform.applications.taxId'), cell: (r) => r.taxIdMasked },
    {
      header: t('admin.platform.applications.bankAccount'),
      cell: (r) => `${r.bankName} · ${r.bankAccountNumberMasked}`,
    },
    {
      header: t('admin.platform.applications.submitted'),
      cell: (r) => formatDate(r.createdAt, locale),
    },
    {
      header: t('admin.platform.common.statusFilter'),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      header: t('admin.platform.common.details'),
      cell: (r) => (
        <Button size="sm" variant="secondary" onClick={() => setParams({ id: r.id })}>
          {t('admin.platform.common.review')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('admin.nav.applications')} />
      <FilterBar>
        <FilterSelect
          label={t('admin.platform.common.statusFilter')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('admin.platform.common.allStatuses')}</option>
          {ApplicationStatusSchema.options.map((value) => (
            <option key={value} value={value}>
              {t(`admin.platform.status.${STATUS_KEY[value]}`)}
            </option>
          ))}
        </FilterSelect>
      </FilterBar>
      <CursorTable
        list={list}
        columns={columns}
        rowKey={(r) => r.id}
        caption={t('admin.nav.applications')}
      />
      {openId ? <ApplicationDialog id={openId} onClose={() => setParams({})} /> : null}
    </>
  );
}

const STATUS_KEY = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' } as const;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-body-s text-text-muted">{label}</dt>
      <dd className="break-words text-body-m text-text-primary">{value}</dd>
    </div>
  );
}

/**
 * Detail of one application. The query is never cached (`gcTime: 0`, `staleTime: 0`): the KYC
 * links are presigned for ~60 s, so every opening fetches fresh ones.
 */
export function ApplicationDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, locale } = useLocale();
  const [action, setAction] = useState<'approve' | 'reject' | null>(null);
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: [...APPLICATIONS_KEY, 'detail', id],
    queryFn: () =>
      unwrap(api.GET('/v1/platform/vendor-applications/{id}', { params: { path: { id } } })),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const reject = useApiMutation(
    (reason: string, headers) =>
      unwrap(
        api.POST('/v1/platform/vendor-applications/{id}/reject', {
          params: { path: { id }, header: headers },
          body: { reason },
        }),
      ),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: APPLICATIONS_KEY });
        setAction(null);
        onClose();
      },
    },
  );

  const app = detail.data;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('admin.platform.applications.detailTitle')}</DialogTitle>
          <DialogDescription>
            {app?.applicantName ?? t('admin.platform.common.loading')}
          </DialogDescription>
        </DialogHeader>
        {detail.isError ? <ErrorAlert error={detail.error} /> : null}
        {app ? (
          <>
            <StatusBadge status={app.status} />
            <dl className="grid gap-3 sm:grid-cols-2">
              <Field label={t('admin.platform.applications.taxId')} value={app.taxId} />
              <Field
                label={t('admin.platform.applications.nationalId')}
                value={app.nationalIdNumber}
              />
              <Field label={t('admin.platform.applications.bank')} value={app.bankName} />
              <Field
                label={t('admin.platform.applications.bankAccount')}
                value={app.bankAccountNumber}
              />
              <Field
                label={t('admin.platform.applications.accountHolder')}
                value={app.accountHolder}
              />
              <Field
                label={t('admin.platform.applications.submitted')}
                value={formatDate(app.createdAt, locale)}
              />
              {app.rejectReason ? (
                <Field
                  label={t('admin.platform.applications.rejectReason')}
                  value={app.rejectReason}
                />
              ) : null}
            </dl>
            <section className="grid gap-2">
              <h3 className="text-body-m font-semibold">
                {t('admin.platform.applications.documents')}
              </h3>
              <p className="text-body-s text-text-muted">
                {t('admin.platform.applications.documentsHint')}
              </p>
              <div className="flex flex-wrap gap-2">
                <DocumentLink
                  href={app.businessLicenseUrl}
                  label={t('admin.platform.applications.businessLicense')}
                />
                <DocumentLink
                  href={app.nationalIdUrl}
                  label={t('admin.platform.applications.nationalIdDocument')}
                />
              </div>
            </section>
            {app.status === 'PENDING' ? (
              <DialogFooter>
                <Button variant="destructive" onClick={() => setAction('reject')}>
                  {t('admin.platform.applications.reject')}
                </Button>
                <Button onClick={() => setAction('approve')}>
                  {t('admin.platform.applications.approve')}
                </Button>
              </DialogFooter>
            ) : null}
          </>
        ) : null}
      </DialogContent>
      {app ? (
        <>
          <ApproveDialog
            open={action === 'approve'}
            applicationId={id}
            applicantName={app.applicantName}
            onOpenChange={(open) => !open && setAction(null)}
            onDone={() => {
              setAction(null);
              onClose();
            }}
          />
          <ConfirmReasonDialog
            open={action === 'reject'}
            onOpenChange={(open) => {
              if (!open) {
                setAction(null);
                reject.reset();
                reject.resetAction();
              }
            }}
            title={t('admin.platform.applications.rejectTitle')}
            description={t('admin.platform.applications.rejectDescription')}
            confirmLabel={t('admin.platform.applications.reject')}
            reasonLabel={t('admin.platform.applications.rejectReason')}
            destructive
            pending={reject.isPending}
            error={reject.error}
            onConfirm={(reason) => reject.mutate(reason)}
          />
        </>
      ) : null}
    </Dialog>
  );
}

function DocumentLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      className={buttonVariants({ variant: 'secondary', size: 'sm' })}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  );
}

export function ApproveDialog({
  open,
  applicationId,
  applicantName,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  applicationId: string;
  applicantName: string;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <ApproveForm
            applicationId={applicationId}
            applicantName={applicantName}
            onCancel={() => onOpenChange(false)}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ApproveForm({
  applicationId,
  applicantName,
  onCancel,
  onDone,
}: {
  applicationId: string;
  applicantName: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(applicantName);
  const [slug, setSlug] = useState(suggestSlug(applicantName));
  const [slugEdited, setSlugEdited] = useState(false);
  const [touched, setTouched] = useState(false);

  const trimmedName = displayName.trim();
  const nameValid = trimmedName.length >= 1 && trimmedName.length <= 120;
  const slugValid = slug.length >= 1 && SlugSchema.safeParse(slug).success;

  const approve = useApiMutation(
    (body: { slug: string; displayName: string }, headers) =>
      unwrap(
        api.POST('/v1/platform/vendor-applications/{id}/approve', {
          params: { path: { id: applicationId }, header: headers },
          body,
        }),
      ),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: APPLICATIONS_KEY });
        onDone();
      },
    },
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (nameValid && slugValid) approve.mutate({ slug, displayName: trimmedName });
  }

  const error = approve.error;
  const conflict =
    error instanceof ApiError &&
    error.status === 409 &&
    error.errorCode === 'common.error.conflict';

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('admin.platform.applications.approveTitle')}</DialogTitle>
        <DialogDescription>{t('admin.platform.applications.approveDescription')}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="approve-name">{t('admin.platform.applications.displayName')}</Label>
        <Input
          id="approve-name"
          value={displayName}
          invalid={touched && !nameValid}
          onChange={(e) => {
            setDisplayName(e.target.value);
            if (!slugEdited) setSlug(suggestSlug(e.target.value));
          }}
        />
        {touched && !nameValid ? (
          <p role="alert" className="text-body-s text-danger-fg">
            {t('admin.platform.applications.displayNameRequired')}
          </p>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="approve-slug">{t('admin.platform.applications.slug')}</Label>
        <Input
          id="approve-slug"
          value={slug}
          invalid={touched && !slugValid}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugEdited(true);
          }}
        />
        {touched && !slugValid ? (
          <p role="alert" className="text-body-s text-danger-fg">
            {t('admin.platform.applications.slugInvalid')}
          </p>
        ) : (
          <p className="text-body-s text-text-muted">{t('admin.platform.applications.slugHint')}</p>
        )}
      </div>
      {conflict ? (
        <p role="alert" className="text-body-s text-danger-fg">
          {t('admin.platform.applications.slugTaken')}
        </p>
      ) : error ? (
        <ErrorAlert error={error} />
      ) : null}
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('admin.platform.common.cancel')}
        </Button>
        <Button type="submit" loading={approve.isPending}>
          {t('admin.platform.applications.approve')}
        </Button>
      </DialogFooter>
    </form>
  );
}
