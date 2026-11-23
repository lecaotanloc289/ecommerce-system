import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import {
  ShippingMethodInputSchema,
  ShippingMethodSchema,
  type Currency,
  type ShippingMethod,
  type ShippingMethodInput,
} from '@repo/core';
import { formatMoney } from '@repo/i18n';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@repo/ui';
import { api } from '@/auth/session';
import { ErrorAlert } from '@/components/error-alert';
import { FormField } from '@/components/form-field';
import { MoneyInput } from '@/components/money-input';
import { PageHeader } from '@/components/page-header';
import { StatusPill } from '@/components/status-badge';
import { useLocale } from '@/i18n/use-locale';
import { unwrap } from '@/lib/api-error';
import { formatMoneyInput, moneyFromInput } from '@/lib/money-input';
import { useApiMutation } from '@/lib/use-api-mutation';

const QUERY_KEY = ['vendor', 'shipping-methods'];
const CURRENCIES: readonly Currency[] = ['VND', 'USD'];

interface MethodForm {
  name: string;
  price: string;
  currency: Currency;
  estDays: string;
  isActive: boolean;
}

function emptyForm(): MethodForm {
  return { name: '', price: '', currency: 'VND', estDays: '3', isActive: true };
}

function toForm(method: ShippingMethod): MethodForm {
  return {
    name: method.name,
    price: formatMoneyInput(method.price.amount, method.price.currency),
    currency: method.price.currency,
    estDays: String(method.estDays),
    isActive: method.isActive,
  };
}

/** Form text → API body, or `null` when invalid (price parsed exactly to minor units). */
export function parseMethodForm(form: MethodForm): ShippingMethodInput | null {
  const price = moneyFromInput(form.price, form.currency);
  if (!price || !/^\d+$/.test(form.estDays.trim())) return null;
  const parsed = ShippingMethodInputSchema.safeParse({
    name: form.name,
    price,
    estDays: Number(form.estDays),
    isActive: form.isActive,
  });
  return parsed.success ? parsed.data : null;
}

/** `/vendor/shipping` — the shop's shipping methods: list, create, edit, deactivate. */
export function ShippingPage() {
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ method: ShippingMethod | null } | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () =>
      unwrap(api.GET('/v1/vendor/shipping-methods')).then((data) =>
        ShippingMethodSchema.array().parse(data),
      ),
  });

  const deactivate = useApiMutation(
    (id: string, headers) =>
      unwrap(
        api.POST('/v1/vendor/shipping-methods/{id}/deactivate', {
          params: { path: { id }, header: headers },
        }),
      ),
    {
      onSuccess: () => {
        toast.success(t('admin.vendor.shipping.deactivated'));
        return queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      },
    },
  );

  return (
    <>
      <PageHeader
        title={t('admin.nav.shipping')}
        actions={
          <Button iconLeft={<Plus aria-hidden />} onClick={() => setEditing({ method: null })}>
            {t('admin.vendor.shipping.new')}
          </Button>
        }
      />
      {query.error ? <ErrorAlert error={query.error} /> : null}
      {deactivate.error ? <ErrorAlert className="mb-4" error={deactivate.error} /> : null}
      {query.data && query.data.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-default bg-bg-elevated px-6 py-12 text-center text-body-s text-text-muted">
          {t('admin.vendor.shipping.empty')}
        </p>
      ) : null}
      {query.data && query.data.length > 0 ? (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.vendor.shipping.name')}</TableHead>
                <TableHead>{t('admin.vendor.shipping.price')}</TableHead>
                <TableHead>{t('admin.vendor.shipping.estDays')}</TableHead>
                <TableHead>{t('admin.vendor.shipping.state')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('admin.vendor.orders.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((method) => (
                <TableRow key={method.id}>
                  <TableCell className="font-semibold">{method.name}</TableCell>
                  <TableCell>{formatMoney(method.price, locale)}</TableCell>
                  <TableCell>
                    {t('admin.vendor.shipping.days', { count: method.estDays })}
                  </TableCell>
                  <TableCell>
                    <StatusPill tone={method.isActive ? 'success' : 'neutral'}>
                      {method.isActive
                        ? t('admin.vendor.shipping.active')
                        : t('admin.vendor.shipping.inactive')}
                    </StatusPill>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t('admin.vendor.shipping.editNamed', { name: method.name })}
                        onClick={() => setEditing({ method })}
                      >
                        {t('admin.vendor.common.edit')}
                      </Button>
                      {method.isActive ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t('admin.vendor.shipping.deactivateNamed', {
                            name: method.name,
                          })}
                          loading={deactivate.isPending && deactivate.variables === method.id}
                          onClick={() => deactivate.mutate(method.id)}
                        >
                          {t('admin.vendor.shipping.deactivate')}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {editing ? (
        <MethodDialog
          key={editing.method?.id ?? 'new'}
          method={editing.method}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function MethodDialog({ method, onClose }: { method: ShippingMethod | null; onClose: () => void }) {
  const t = useLocale().t;
  const queryClient = useQueryClient();
  const [form, setForm] = useState(method ? toForm(method) : emptyForm());
  const [invalid, setInvalid] = useState(false);

  const save = useApiMutation(
    (body: ShippingMethodInput, headers) =>
      method
        ? unwrap(
            api.PUT('/v1/vendor/shipping-methods/{id}', {
              params: { path: { id: method.id }, header: headers },
              body,
            }),
          )
        : unwrap(api.POST('/v1/vendor/shipping-methods', { params: { header: headers }, body })),
    {
      onSuccess: () => {
        toast.success(t('admin.vendor.shipping.saved'));
        onClose();
        return queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      },
    },
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = parseMethodForm(form);
    setInvalid(body === null);
    if (body) save.mutate(body);
  };
  const priceInvalid = invalid && moneyFromInput(form.price, form.currency) === null;
  const days = /^\d+$/.test(form.estDays.trim()) ? Number(form.estDays) : 0;
  const daysInvalid = invalid && (days < 1 || days > 60);
  const required = t('admin.vendor.form.error.required');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {method ? t('admin.vendor.shipping.editTitle') : t('admin.vendor.shipping.new')}
            </DialogTitle>
          </DialogHeader>
          <FormField
            id="method-name"
            label={t('admin.vendor.shipping.name')}
            error={invalid && form.name.trim() === '' ? required : undefined}
          >
            <Input
              id="method-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </FormField>
          <div className="grid grid-cols-[1fr_auto] items-end gap-3">
            <FormField
              id="method-price"
              label={t('admin.vendor.shipping.price')}
              error={priceInvalid ? t('admin.vendor.form.error.price') : undefined}
            >
              <MoneyInput
                id="method-price"
                label={t('admin.vendor.shipping.price')}
                value={form.price}
                currency={form.currency}
                onChange={(price) => setForm({ ...form, price })}
              />
            </FormField>
            <select
              aria-label={t('admin.vendor.form.currency')}
              className="h-10 rounded-md border border-border-input bg-bg-elevated px-3 text-body-m"
              value={form.currency}
              onChange={(event) => {
                const next = CURRENCIES.find((currency) => currency === event.target.value);
                if (next) setForm({ ...form, currency: next });
              }}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
          <FormField
            id="method-days"
            label={t('admin.vendor.shipping.estDays')}
            error={daysInvalid ? t('admin.vendor.shipping.daysInvalid') : undefined}
          >
            <Input
              id="method-days"
              inputMode="numeric"
              value={form.estDays}
              onChange={(e) => setForm({ ...form, estDays: e.target.value })}
            />
          </FormField>
          <div className="flex items-center gap-2">
            <Switch
              id="method-active"
              checked={form.isActive}
              onCheckedChange={(isActive) => setForm({ ...form, isActive })}
            />
            <label htmlFor="method-active" className="text-body-s">
              {t('admin.vendor.shipping.active')}
            </label>
          </div>
          {invalid && !priceInvalid && !daysInvalid && form.name.trim() !== '' ? (
            <p role="alert" className="text-caption text-danger-fg">
              {t('admin.vendor.shipping.fieldsInvalid')}
            </p>
          ) : null}
          {save.error ? <ErrorAlert error={save.error} /> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('admin.vendor.common.cancel')}
            </Button>
            <Button type="submit" loading={save.isPending}>
              {t('admin.vendor.form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
