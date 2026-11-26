import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SubOrderShipSchema, type SubOrderStatus } from '@repo/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
} from '@repo/ui';
import { api } from '@/auth/session';
import { ErrorAlert } from '@/components/error-alert';
import { FormField } from '@/components/form-field';
import { useT } from '@/i18n/use-locale';
import { ApiError, unwrap } from '@/lib/api-error';
import { useApiMutation } from '@/lib/use-api-mutation';

/** Max length of carrier / tracking number (`SubOrderShipSchema`). */
const MAX_SHIP_FIELD = 80;

/** Which vendor action a sub-order status offers: PAID → accept, PROCESSING → ship, SHIPPED → deliver. */
export type OrderAction = 'accept' | 'ship' | 'deliver';

export function actionFor(status: SubOrderStatus): OrderAction | null {
  switch (status) {
    case 'PAID':
      return 'accept';
    case 'PROCESSING':
      return 'ship';
    case 'SHIPPED':
      return 'deliver';
    default:
      return null;
  }
}

/**
 * The one button a sub-order's status allows. A 409 `order.error.invalid-status-transition` means
 * the order moved meanwhile (another staff member, or the customer): lists and detail refetch so
 * the buttons match reality.
 */
export function OrderActions({ orderId, status }: { orderId: string; status: SubOrderStatus }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [shipOpen, setShipOpen] = useState(false);
  const action = actionFor(status);

  const refetch = () => queryClient.invalidateQueries({ queryKey: ['vendor', 'orders'] });
  const onError = (error: Error) => {
    if (error instanceof ApiError && error.errorCode === 'order.error.invalid-status-transition') {
      void refetch();
    }
  };

  const accept = useApiMutation(
    (_: void, headers) =>
      unwrap(
        api.POST('/v1/vendor/sub-orders/{id}/accept', {
          params: { path: { id: orderId }, header: headers },
        }),
      ),
    {
      onSuccess: () => {
        toast.success(t('admin.vendor.orders.accepted'));
        return refetch();
      },
      onError,
    },
  );
  const deliver = useApiMutation(
    (_: void, headers) =>
      unwrap(
        api.POST('/v1/vendor/sub-orders/{id}/deliver', {
          params: { path: { id: orderId }, header: headers },
        }),
      ),
    {
      onSuccess: () => {
        toast.success(t('admin.vendor.orders.delivered'));
        return refetch();
      },
      onError,
    },
  );
  const ship = useApiMutation(
    (body: { carrier: string; trackingNumber: string }, headers) =>
      unwrap(
        api.POST('/v1/vendor/sub-orders/{id}/ship', {
          params: { path: { id: orderId }, header: headers },
          body,
        }),
      ),
    {
      onSuccess: () => {
        setShipOpen(false);
        toast.success(t('admin.vendor.orders.shipped'));
        return refetch();
      },
      onError,
    },
  );

  if (!action) return null;
  // Only the current action's error: a stale one would linger after a refetch moves the order on.
  const error = action === 'accept' ? accept.error : action === 'deliver' ? deliver.error : null;

  return (
    <div className="flex flex-col items-end gap-2">
      {action === 'accept' ? (
        <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate()}>
          {t('admin.vendor.orders.accept')}
        </Button>
      ) : null}
      {action === 'ship' ? (
        <Button size="sm" onClick={() => setShipOpen(true)}>
          {t('admin.vendor.orders.ship')}
        </Button>
      ) : null}
      {action === 'deliver' ? (
        <Button size="sm" loading={deliver.isPending} onClick={() => deliver.mutate()}>
          {t('admin.vendor.orders.deliver')}
        </Button>
      ) : null}
      {error ? <ErrorAlert error={error} /> : null}
      <ShipDialog
        open={shipOpen}
        onOpenChange={(open) => {
          setShipOpen(open);
          if (!open) ship.reset();
        }}
        pending={ship.isPending}
        error={ship.error}
        onSubmit={(body) => ship.mutate(body)}
      />
    </div>
  );
}

function ShipDialog({
  open,
  onOpenChange,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  error: Error | null;
  onSubmit: (body: { carrier: string; trackingNumber: string }) => void;
}) {
  const t = useT();
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [invalid, setInvalid] = useState(false);
  const lengthError = (value: string) =>
    value.trim() === ''
      ? t('admin.vendor.form.error.required')
      : value.trim().length > MAX_SHIP_FIELD
        ? t('admin.vendor.form.error.tooLong', { max: MAX_SHIP_FIELD })
        : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = SubOrderShipSchema.safeParse({ carrier, trackingNumber });
    setInvalid(!parsed.success);
    if (parsed.success) onSubmit(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('admin.vendor.orders.shipTitle')}</DialogTitle>
            <DialogDescription>{t('admin.vendor.orders.shipDescription')}</DialogDescription>
          </DialogHeader>
          <FormField
            id="ship-carrier"
            label={t('admin.vendor.orders.carrier')}
            error={invalid ? lengthError(carrier) : undefined}
          >
            <Input id="ship-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          </FormField>
          <FormField
            id="ship-tracking"
            label={t('admin.vendor.orders.tracking')}
            error={
              invalid && trackingNumber.trim() === ''
                ? t('admin.vendor.form.error.required')
                : undefined
            }
          >
            <Input
              id="ship-tracking"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
            />
          </FormField>
          {error ? <ErrorAlert error={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('admin.vendor.common.cancel')}
            </Button>
            <Button type="submit" loading={pending}>
              {t('admin.vendor.orders.confirmShip')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
