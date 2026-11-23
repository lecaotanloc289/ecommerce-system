import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PlatformRole, Role } from '@repo/core';
import { Badge, Button } from '@repo/ui';
import { api } from '@/auth/session';
import { ROLE_LABEL_KEYS } from '@/auth/roles';
import { CursorTable, type Column } from '@/components/cursor-table';
import { ErrorAlert } from '@/components/error-alert';
import { FilterBar, SearchForm } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { useLocale } from '@/i18n/use-locale';
import { compact } from '@/lib/compact';
import { unwrap } from '@/lib/api-error';
import { useApiMutation } from '@/lib/use-api-mutation';
import { useCursorList } from '@/lib/use-cursor-list';

type UserRow = { id: string; email: string | null; name: string; roles: Role[] };

type RoleChange = { id: string; role: PlatformRole; action: 'grant' | 'revoke' };

const USERS_KEY = ['platform', 'users'] as const;

export function UsersPage() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');

  const list = useCursorList<UserRow>([...USERS_KEY, 'list', q], (cursor) =>
    unwrap(
      api.GET('/v1/platform/users', {
        params: { query: compact({ q: q || undefined, cursor, limit: 20 }) },
      }),
    ),
  );

  const change = useApiMutation(
    (v: RoleChange, headers) =>
      v.action === 'grant'
        ? unwrap(
            api.POST('/v1/platform/users/{id}/roles', {
              params: { path: { id: v.id }, header: headers },
              body: { role: v.role },
            }),
          )
        : unwrap(
            api.DELETE('/v1/platform/users/{id}/roles/{role}', {
              params: { path: { id: v.id, role: v.role }, header: headers },
            }),
          ),
    { onSettled: () => queryClient.invalidateQueries({ queryKey: USERS_KEY }) },
  );

  const roleButton = (user: UserRow, role: PlatformRole, labelKey: Parameters<typeof t>[0]) => {
    const held = user.roles.includes(role);
    const busy =
      change.isPending && change.variables?.id === user.id && change.variables.role === role;
    return (
      <Button
        key={`${role}-${held ? 'revoke' : 'grant'}`}
        size="sm"
        variant={held ? 'destructive' : 'secondary'}
        loading={busy}
        onClick={() => change.mutate({ id: user.id, role, action: held ? 'revoke' : 'grant' })}
      >
        {t(labelKey)}
      </Button>
    );
  };

  const columns: Column<UserRow>[] = [
    { header: t('admin.platform.users.user'), cell: (u) => u.name },
    {
      header: t('admin.platform.users.email'),
      cell: (u) => u.email ?? t('admin.platform.common.none'),
    },
    {
      header: t('admin.platform.users.roles'),
      cell: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.roles.map((role) => (
            <Badge key={role} variant="neutral">
              {t(ROLE_LABEL_KEYS[role])}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      header: t('admin.platform.common.details'),
      cell: (u) => (
        <div className="flex flex-wrap gap-2">
          {roleButton(
            u,
            'PLATFORM_STAFF',
            u.roles.includes('PLATFORM_STAFF')
              ? 'admin.platform.users.revokeStaff'
              : 'admin.platform.users.grantStaff',
          )}
          {roleButton(
            u,
            'PLATFORM_ADMIN',
            u.roles.includes('PLATFORM_ADMIN')
              ? 'admin.platform.users.revokeAdmin'
              : 'admin.platform.users.grantAdmin',
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('admin.nav.users')} />
      <FilterBar>
        <SearchForm
          value={q}
          onSearch={setQ}
          placeholder={t('admin.platform.users.searchPlaceholder')}
        />
      </FilterBar>
      {change.isError ? <ErrorAlert error={change.error} className="mb-3" /> : null}
      <CursorTable
        list={list}
        columns={columns}
        rowKey={(u) => u.id}
        caption={t('admin.nav.users')}
      />
    </>
  );
}
