import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { OrderStatusSchema, type LedgerAccount, type LedgerEntryType } from '@repo/core';
import { formatDate, formatDateTime, formatMoney, type MessageKey } from '@repo/i18n';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui';
import { api, useCurrentUser } from '@/auth/session';
import { ConfirmReasonDialog } from '@/components/confirm-reason-dialog';
import { CursorTable, type Column } from '@/components/cursor-table';
import { ErrorAlert } from '@/components/error-alert';
import { FilterBar, FilterSelect, SearchForm } from '@/components/filter-bar';
import { MoneyText } from '@/components/money-text';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { useLocale } from '@/i18n/use-locale';
import { compact } from '@/lib/compact';
import { unwrap } from '@/lib/api-error';
import { useApiMutation } from '@/lib/use-api-mutation';
import { useCursorList } from '@/lib/use-cursor-list';
import { RetryRefundAction } from './retry-refund';

type OrderRow = {
  id: string;
  status: Parameters<typeof StatusBadge>[0]['status'];
  grandTotal: Parameters<typeof MoneyText>[0]['money'];
  subOrderCount: number;
  customerName: string;
  customerEmail: string | null;
  createdAt: string;
};

export const ORDERS_KEY = ['platform', 'orders'] as const;

const ORDER_STATUS_KEYS = {
  AWAITING_PAYMENT: 'awaitingPayment',
  PAID: 'paid',
  PARTIALLY_REFUNDED: 'partiallyRefunded',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
} as const;

const LEDGER_ACCOUNT_KEYS: Record<LedgerAccount, MessageKey> = {
  CUSTOMER: 'admin.platform.ledgerAccount.customer',
  PLATFORM_ESCROW: 'admin.platform.ledgerAccount.platformEscrow',
  VENDOR_WALLET: 'admin.platform.ledgerAccount.vendorWallet',
  PLATFORM_REVENUE: 'admin.platform.ledgerAccount.platformRevenue',
};

const LEDGER_TYPE_KEYS: Record<LedgerEntryType, MessageKey> = {
  ESCROW_IN: 'admin.platform.ledgerType.escrowIn',
  PAYOUT_OUT: 'admin.platform.ledgerType.payoutOut',
  COMMISSION: 'admin.platform.ledgerType.commission',
  REFUND: 'admin.platform.ledgerType.refund',
  ADJUSTMENT: 'admin.platform.ledgerType.adjustment',
};

/** Sub-order statuses for which the "Refund" button is offered; the server has the final say. */
const REFUND_OFFERED = new Set(['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED']);

export function OrdersPage() {
  const { t, locale } = useLocale();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const parsedStatus = OrderStatusSchema.safeParse(status).data;
  const openId = params.get('id');

  const list = useCursorList<OrderRow>([...ORDERS_KEY, 'list', parsedStatus, q], (cursor) =>
    unwrap(
      api.GET('/v1/platform/orders', {
        params: { query: compact({ status: parsedStatus, q: q || undefined, cursor, limit: 20 }) },
      }),
    ),
  );

  const columns: Column<OrderRow>[] = [
    {
      header: t('admin.platform.orders.order'),
      cell: (o) => <span className="font-mono text-body-s">{o.id}</span>,
    },
    {
      header: t('admin.platform.orders.customer'),
      cell: (o) => `${o.customerName}${o.customerEmail ? ` · ${o.customerEmail}` : ''}`,
    },
    { header: t('admin.platform.orders.total'), cell: (o) => <MoneyText money={o.grandTotal} /> },
    { header: t('admin.platform.orders.subOrders'), cell: (o) => o.subOrderCount },
    {
      header: t('admin.platform.common.statusFilter'),
      cell: (o) => <StatusBadge status={o.status} />,
    },
    { header: t('admin.platform.common.created'), cell: (o) => formatDate(o.createdAt, locale) },
    {
      header: t('admin.platform.common.details'),
      cell: (o) => (
        <Button size="sm" variant="secondary" onClick={() => setParams({ id: o.id })}>
          {t('admin.platform.common.details')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader title={t('admin.nav.orders')} />
      <FilterBar>
        <FilterSelect
          label={t('admin.platform.common.statusFilter')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('admin.platform.common.allStatuses')}</option>
          {OrderStatusSchema.options.map((value) => (
            <option key={value} value={value}>
              {t(`admin.platform.status.${ORDER_STATUS_KEYS[value]}`)}
            </option>
          ))}
        </FilterSelect>
        <SearchForm
          value={q}
          onSearch={setQ}
          placeholder={t('admin.platform.orders.searchPlaceholder')}
        />
      </FilterBar>
      <CursorTable
        list={list}
        columns={columns}
        rowKey={(o) => o.id}
        caption={t('admin.nav.orders')}
      />
      {openId ? <OrderDialog id={openId} onClose={() => setParams({})} /> : null}
    </>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="mt-2 text-body-m font-semibold text-text-primary">{children}</h3>;
}

export function OrderDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, locale } = useLocale();
  const user = useCurrentUser();
  const isAdmin = user.roles.includes('PLATFORM_ADMIN');
  const queryClient = useQueryClient();
  const [refundTarget, setRefundTarget] = useState<{
    id: string;
    total: OrderRow['grandTotal'];
  } | null>(null);

  const detail = useQuery({
    queryKey: [...ORDERS_KEY, 'detail', id],
    queryFn: () => unwrap(api.GET('/v1/platform/orders/{id}', { params: { path: { id } } })),
  });

  const refund = useApiMutation(
    (v: { subOrderId: string; reason: string }, headers) =>
      unwrap(
        api.POST('/v1/platform/sub-orders/{id}/refund', {
          params: { path: { id: v.subOrderId }, header: headers },
          body: { reason: v.reason },
        }),
      ),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: ORDERS_KEY });
        await queryClient.invalidateQueries({ queryKey: ['platform', 'refunds'] });
        setRefundTarget(null);
      },
    },
  );

  const order = detail.data;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('admin.platform.orders.order')}</DialogTitle>
          <DialogDescription className="font-mono">{id}</DialogDescription>
        </DialogHeader>
        {detail.isError ? <ErrorAlert error={detail.error} /> : null}
        {order ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={order.status} />
              <span>
                {order.customerName}
                {order.customerEmail ? ` · ${order.customerEmail}` : ''}
              </span>
              <MoneyText money={order.grandTotal} />
              <span className="text-body-s text-text-muted">
                {formatDateTime(order.createdAt, locale)}
              </span>
            </div>

            <SectionTitle>{t('admin.platform.orders.subOrders')}</SectionTitle>
            {order.subOrders.map((sub) => (
              <section
                key={sub.id}
                aria-label={sub.vendorName}
                className="grid gap-2 rounded-md border border-border-subtle p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{sub.vendorName}</span>
                  <StatusBadge status={sub.status} />
                  <MoneyText money={sub.total} />
                  {isAdmin && REFUND_OFFERED.has(sub.status) ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="ml-auto"
                      onClick={() => setRefundTarget({ id: sub.id, total: sub.total })}
                    >
                      {t('admin.platform.orders.refundAction')}
                    </Button>
                  ) : null}
                </div>
                <Table aria-label={t('admin.platform.orders.items')}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('admin.platform.orders.items')}</TableHead>
                      <TableHead>{t('admin.platform.orders.quantity')}</TableHead>
                      <TableHead>{t('admin.platform.orders.amount')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sub.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.productTitle}</TableCell>
                        <TableCell>{item.quantity}</TableCell>
                        <TableCell>
                          <MoneyText money={item.lineTotal} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            ))}

            <SectionTitle>{t('admin.platform.orders.payments')}</SectionTitle>
            <Table aria-label={t('admin.platform.orders.payments')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.platform.orders.provider')}</TableHead>
                  <TableHead>{t('admin.platform.orders.amount')}</TableHead>
                  <TableHead>{t('admin.platform.common.statusFilter')}</TableHead>
                  <TableHead>{t('admin.platform.orders.providerTxn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {p.provider} · {t('admin.platform.orders.attempt', { no: p.attemptNo })}
                    </TableCell>
                    <TableCell>
                      <MoneyText money={p.amount} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell>{p.providerTxnId ?? t('admin.platform.common.none')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <SectionTitle>{t('admin.platform.orders.ledger')}</SectionTitle>
            <Table aria-label={t('admin.platform.orders.ledger')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.platform.orders.account')}</TableHead>
                  <TableHead>{t('admin.platform.orders.type')}</TableHead>
                  <TableHead>{t('admin.platform.orders.amount')}</TableHead>
                  <TableHead>{t('admin.platform.common.created')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.ledgerEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{t(LEDGER_ACCOUNT_KEYS[entry.account])}</TableCell>
                    <TableCell>{t(LEDGER_TYPE_KEYS[entry.entryType])}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatMoney(entry.amount, locale)}
                    </TableCell>
                    <TableCell>{formatDateTime(entry.createdAt, locale)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <SectionTitle>{t('admin.platform.orders.refunds')}</SectionTitle>
            {order.refunds.length === 0 ? (
              <p className="text-body-s text-text-muted">{t('admin.platform.orders.noRefunds')}</p>
            ) : (
              <ul className="grid gap-1">
                {order.refunds.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <MoneyText money={r.amount} />
                    <StatusBadge status={r.status} />
                    <span className="text-body-s text-text-muted">{r.reason}</span>
                    <RetryRefundAction refund={r} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </DialogContent>
      <ConfirmReasonDialog
        open={refundTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRefundTarget(null);
            refund.reset();
            refund.resetAction();
          }
        }}
        title={t('admin.platform.orders.refundTitle')}
        description={
          refundTarget
            ? t('admin.platform.orders.refundDescription', {
                amount: formatMoney(refundTarget.total, locale),
              })
            : undefined
        }
        confirmLabel={t('admin.platform.orders.refundConfirm')}
        destructive
        pending={refund.isPending}
        error={refund.error}
        onConfirm={(reason) =>
          refundTarget && refund.mutate({ subOrderId: refundTarget.id, reason })
        }
      />
    </Dialog>
  );
}
