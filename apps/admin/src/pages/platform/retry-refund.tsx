import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Money } from '@repo/core';
import { formatMoney } from '@repo/i18n';
import { Button, toast } from '@repo/ui';
import { api, useCurrentUser } from '@/auth/session';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useLocale } from '@/i18n/use-locale';
import { unwrap } from '@/lib/api-error';
import { useApiMutation } from '@/lib/use-api-mutation';

/**
 * "Retry refund" for a refund the provider refused (FAILED), **PLATFORM_ADMIN only** (hidden
 * otherwise; the API enforces it too). `POST /v1/platform/refunds/:id/retry` creates a new
 * PENDING refund that the worker sends to the provider again; the ledger is not touched.
 */
export function RetryRefundAction({
  refund,
}: {
  refund: { id: string; status: string; amount: Money };
}) {
  const { t, locale } = useLocale();
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const retry = useApiMutation(
    (id: string, headers) =>
      unwrap(
        api.POST('/v1/platform/refunds/{id}/retry', { params: { path: { id }, header: headers } }),
      ),
    {
      onSuccess: async () => {
        toast.success(t('admin.platform.refunds.retried'));
        setOpen(false);
        await queryClient.invalidateQueries({ queryKey: ['platform', 'refunds'] });
        await queryClient.invalidateQueries({ queryKey: ['platform', 'orders'] });
      },
    },
  );

  if (refund.status !== 'FAILED' || !user.roles.includes('PLATFORM_ADMIN')) return null;

  const close = () => {
    setOpen(false);
    retry.reset();
    retry.resetAction();
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t('admin.platform.refunds.retry')}
      </Button>
      <ConfirmDialog
        open={open}
        title={t('admin.platform.refunds.retryTitle')}
        description={t('admin.platform.refunds.retryDescription', {
          amount: formatMoney(refund.amount, locale),
        })}
        confirmLabel={t('admin.platform.refunds.retry')}
        pending={retry.isPending}
        error={retry.error}
        onConfirm={() => retry.mutate(refund.id)}
        onClose={close}
      />
    </>
  );
}
