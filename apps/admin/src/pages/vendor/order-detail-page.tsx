import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { VendorSubOrderSchema, type Money } from '@repo/core';
import { formatDateTime, formatMoney } from '@repo/i18n';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui';
import { api } from '@/auth/session';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { useLocale } from '@/i18n/use-locale';
import { unwrap } from '@/lib/api-error';
import { formatAttributes } from './product-form-model';
import { OrderActions } from './order-actions';
import { OrderStatusBadge } from './vendor-status';

/** `/vendor/orders/:id` — items, shipping address snapshot, money incl. commission / net payout. */
export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { t, locale } = useLocale();
  const query = useQuery({
    queryKey: ['vendor', 'orders', 'detail', id],
    queryFn: () =>
      unwrap(api.GET('/v1/vendor/sub-orders/{id}', { params: { path: { id } } })).then((data) =>
        VendorSubOrderSchema.parse(data),
      ),
  });

  const back = (
    <Link
      to="/vendor/orders"
      className="mb-3 inline-flex items-center gap-1 text-body-s text-text-link hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t('admin.vendor.orders.back')}
    </Link>
  );

  if (query.error) {
    return (
      <>
        {back}
        <ErrorAlert error={query.error} />
      </>
    );
  }
  const order = query.data;
  if (!order) {
    return (
      <>
        {back}
        <p role="status" className="py-8 text-center text-body-s text-text-muted">
          {t('admin.table.loading')}
        </p>
      </>
    );
  }

  const address = order.shippingAddress;
  const money = (value: Money) => formatMoney(value, locale);
  const date = (iso: string | null) => (iso ? formatDateTime(iso, locale) : '—');

  return (
    <>
      {back}
      <PageHeader
        title={t('admin.vendor.orders.detailTitle', { id: order.id.slice(-8) })}
        description={formatDateTime(order.createdAt, locale)}
        actions={
          <div className="flex items-start gap-3">
            <OrderStatusBadge status={order.status} />
            <OrderActions orderId={order.id} status={order.status} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-lg border border-border-subtle bg-bg-elevated">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.vendor.orders.item')}</TableHead>
                <TableHead>{t('admin.vendor.orders.unitPrice')}</TableHead>
                <TableHead>{t('admin.vendor.orders.quantity')}</TableHead>
                <TableHead>{t('admin.vendor.orders.lineTotal')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-semibold">{item.productTitle}</div>
                    {Object.keys(item.attributes).length > 0 ? (
                      <div className="text-caption text-text-muted">
                        {formatAttributes(item.attributes)}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{money(item.unitPrice)}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{money(item.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <div className="flex flex-col gap-6">
          <Panel title={t('admin.vendor.orders.shippingAddress')}>
            <p className="font-semibold">{address.recipientName}</p>
            <p>{address.phone}</p>
            <p>{address.line1}</p>
            {address.line2 ? <p>{address.line2}</p> : null}
            <p>{`${address.ward}, ${address.district}, ${address.city}`}</p>
            <p>{address.country}</p>
          </Panel>

          <Panel title={t('admin.vendor.orders.payment')}>
            <Row label={t('admin.vendor.orders.subtotal')} value={money(order.subtotal)} />
            <Row label={t('admin.vendor.orders.shippingFee')} value={money(order.shipping)} />
            <Row
              label={t('admin.vendor.orders.vendorDiscount')}
              value={money({ ...order.vendorDiscount, amount: -order.vendorDiscount.amount })}
            />
            <Row
              label={t('admin.vendor.orders.commission')}
              value={money({ ...order.commission, amount: -order.commission.amount })}
            />
            <Row label={t('admin.vendor.orders.net')} value={money(order.net)} strong />
            <p className="pt-2 text-caption text-text-muted">
              {t('admin.vendor.orders.customerPaid', { total: money(order.total) })}
            </p>
          </Panel>

          <Panel title={t('admin.vendor.orders.fulfilment')}>
            {order.shippingMethodName ? (
              <Row label={t('admin.vendor.orders.method')} value={order.shippingMethodName} />
            ) : null}
            <Row label={t('admin.vendor.orders.carrier')} value={order.carrier ?? '—'} />
            <Row label={t('admin.vendor.orders.tracking')} value={order.trackingNumber ?? '—'} />
            <Row label={t('admin.vendor.orders.shippedAt')} value={date(order.shippedAt)} />
            <Row label={t('admin.vendor.orders.deliveredAt')} value={date(order.deliveredAt)} />
            <Row label={t('admin.vendor.orders.completedAt')} value={date(order.completedAt)} />
          </Panel>
        </div>
      </div>
    </>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-bg-elevated p-4 text-body-s">
      <h2 className="mb-1 font-heading text-body-m font-semibold text-text-primary">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`flex justify-between gap-3 ${strong ? 'font-semibold text-text-primary' : ''}`}
    >
      <span className="text-text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}
