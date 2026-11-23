import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  VendorInvitationCreateSchema,
  VendorInvitationPageSchema,
  VendorStaffMemberSchema,
  type VendorInvitation,
  type VendorStaffMember,
} from '@repo/core';
import { formatDate } from '@repo/i18n';
import {
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@repo/ui';
import { api, useCurrentUser } from '@/auth/session';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type Column } from '@/components/data-table';
import { ErrorAlert } from '@/components/error-alert';
import { FormField } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { useLocale } from '@/i18n/use-locale';
import { toApiError, unwrap } from '@/lib/api-error';
import { useApiMutation } from '@/lib/use-api-mutation';
import { useCursorList } from '@/lib/use-cursor-list';
import { InvitationStatusBadge } from './vendor-status';

const STAFF_KEY = ['vendor', 'staff'];
const INVITATIONS_KEY = ['vendor', 'invitations'];

/** `/vendor/staff` (owner only) — team members, invite by email, invitations, revoke / remove. */
export function StaffPage() {
  const { t, locale } = useLocale();
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [removing, setRemoving] = useState<VendorStaffMember | null>(null);

  const staff = useQuery({
    queryKey: STAFF_KEY,
    queryFn: () =>
      unwrap(api.GET('/v1/vendor/staff')).then((data) =>
        VendorStaffMemberSchema.array().parse(data),
      ),
  });
  const invitations = useCursorList<VendorInvitation>(INVITATIONS_KEY, (cursor) =>
    unwrap(
      api.GET('/v1/vendor/invitations', {
        params: { query: { limit: 20, ...(cursor ? { cursor } : {}) } },
      }),
    ).then((data) => VendorInvitationPageSchema.parse(data)),
  );

  const invite = useApiMutation(
    (body: { email: string }, headers) =>
      unwrap(api.POST('/v1/vendor/invitations', { params: { header: headers }, body })),
    {
      onSuccess: () => {
        setEmail('');
        toast.success(t('admin.vendor.staff.invited'));
        return queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
      },
    },
  );
  const revoke = useApiMutation(
    (id: string, headers) =>
      unwrap(
        api.POST('/v1/vendor/invitations/{id}/revoke', {
          params: { path: { id }, header: headers },
        }),
      ),
    {
      onSuccess: () => {
        toast.success(t('admin.vendor.staff.revoked'));
        return queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY });
      },
    },
  );
  const remove = useApiMutation(
    async (userId: string, headers) => {
      const { error, response } = await api.DELETE('/v1/vendor/staff/{userId}', {
        params: { path: { userId }, header: headers },
      });
      if (!response.ok) throw toApiError(response.status, error);
    },
    {
      onSuccess: () => {
        setRemoving(null);
        toast.success(t('admin.vendor.staff.removed'));
        return queryClient.invalidateQueries({ queryKey: STAFF_KEY });
      },
    },
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = VendorInvitationCreateSchema.safeParse({ email: email.trim() });
    setEmailInvalid(!parsed.success);
    if (parsed.success) invite.mutate(parsed.data);
  };

  const invitationColumns: Column<VendorInvitation>[] = [
    { key: 'email', header: t('admin.vendor.staff.email'), cell: (row) => row.email },
    {
      key: 'status',
      header: t('admin.vendor.orders.status'),
      cell: (row) => <InvitationStatusBadge status={row.status} />,
    },
    {
      key: 'expires',
      header: t('admin.vendor.staff.expires'),
      cell: (row) => formatDate(row.expiresAt, locale),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('admin.vendor.orders.actions')}</span>,
      cell: (row) =>
        row.status === 'PENDING' ? (
          <Button
            size="sm"
            variant="secondary"
            aria-label={t('admin.vendor.staff.revokeFor', { email: row.email })}
            loading={revoke.isPending && revoke.variables === row.id}
            onClick={() => revoke.mutate(row.id)}
          >
            {t('admin.vendor.staff.revoke')}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title={t('admin.nav.staff')} />

      <section className="mb-8">
        <h2 className="mb-3 font-heading text-body-l font-semibold text-text-primary">
          {t('admin.vendor.staff.team')}
        </h2>
        {staff.error ? <ErrorAlert error={staff.error} /> : null}
        {staff.data ? (
          <div className="rounded-lg border border-border-subtle bg-bg-elevated">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.vendor.staff.name')}</TableHead>
                  <TableHead>{t('admin.vendor.staff.email')}</TableHead>
                  <TableHead>{t('admin.vendor.staff.role')}</TableHead>
                  <TableHead>{t('admin.vendor.staff.joined')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('admin.vendor.orders.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.data.map((member) => (
                  <TableRow key={member.userId}>
                    <TableCell className="font-semibold">{member.name}</TableCell>
                    <TableCell>{member.email ?? '—'}</TableCell>
                    <TableCell>
                      {member.role === 'VENDOR_OWNER'
                        ? t('admin.role.vendorOwner')
                        : t('admin.role.vendorStaff')}
                    </TableCell>
                    <TableCell>{formatDate(member.joinedAt, locale)}</TableCell>
                    <TableCell>
                      {member.role === 'VENDOR_STAFF' && member.userId !== me.id ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('admin.vendor.staff.removeNamed', { name: member.name })}
                          onClick={() => {
                            remove.reset();
                            setRemoving(member);
                          }}
                        >
                          {t('admin.vendor.staff.remove')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 font-heading text-body-l font-semibold text-text-primary">
          {t('admin.vendor.staff.invitations')}
        </h2>
        <form onSubmit={submit} noValidate className="mb-4 flex flex-wrap items-end gap-3">
          <div className="w-full max-w-sm">
            <FormField
              id="invite-email"
              label={t('admin.vendor.staff.inviteEmail')}
              error={emailInvalid ? t('admin.vendor.staff.emailInvalid') : undefined}
            >
              <Input
                id="invite-email"
                type="email"
                value={email}
                invalid={emailInvalid}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
          </div>
          <Button type="submit" loading={invite.isPending}>
            {t('admin.vendor.staff.invite')}
          </Button>
        </form>
        {invite.error ? <ErrorAlert className="mb-4" error={invite.error} /> : null}
        {revoke.error ? <ErrorAlert className="mb-4" error={revoke.error} /> : null}
        <DataTable
          columns={invitationColumns}
          rows={invitations.items}
          getKey={(row) => row.id}
          isLoading={invitations.isPending}
          error={invitations.error}
          emptyText={t('admin.vendor.staff.noInvitations')}
          hasNextPage={invitations.hasNextPage}
          isFetchingNextPage={invitations.isFetchingNextPage}
          onLoadMore={() => void invitations.fetchNextPage()}
        />
      </section>

      <ConfirmDialog
        open={removing !== null}
        title={t('admin.vendor.staff.removeTitle')}
        description={t('admin.vendor.staff.removeDescription', { name: removing?.name ?? '' })}
        confirmLabel={t('admin.vendor.staff.remove')}
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => removing && remove.mutate(removing.userId)}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}
