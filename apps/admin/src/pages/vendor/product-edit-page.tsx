import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { VendorProductSchema, type ProductUpsert, type VendorProduct } from '@repo/core';
import { Alert, AlertDescription, Button, toast } from '@repo/ui';
import { api } from '@/auth/session';
import { ErrorAlert } from '@/components/error-alert';
import { PageHeader } from '@/components/page-header';
import { useLocale } from '@/i18n/use-locale';
import { unwrap } from '@/lib/api-error';
import { uploadFile } from '@/lib/upload';
import { useApiMutation } from '@/lib/use-api-mutation';
import { flattenCategories } from './categories';
import { ProductForm } from './product-form';
import { emptyProductForm, fromProduct, toRequestBody } from './product-form-model';
import { currencyOptions, useVendorCurrency } from './vendor-currency';
import { ProductStatusBadge } from './vendor-status';

/** `/vendor/products/new` and `/vendor/products/:id` — create (→ DRAFT) or edit a product. */
export function ProductEditPage() {
  const { id } = useParams();
  const { t, locale } = useLocale();
  const categoriesQuery = useQuery({
    queryKey: ['categories', locale],
    queryFn: () =>
      unwrap(api.GET('/v1/categories', { params: { query: { locale } } })).then(
        (tree) => tree.items,
      ),
  });
  const categories = useMemo(
    () => flattenCategories(categoriesQuery.data ?? []),
    [categoriesQuery.data],
  );

  const back = (
    <Link
      to="/vendor/products"
      className="mb-3 inline-flex items-center gap-1 text-body-s text-text-link hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      {t('admin.vendor.products.back')}
    </Link>
  );

  if (categoriesQuery.error) return <ErrorAlert error={categoriesQuery.error} />;
  if (categoriesQuery.isPending) {
    return (
      <p role="status" className="py-8 text-center text-body-s text-text-muted">
        {t('admin.table.loading')}
      </p>
    );
  }

  return (
    <>
      {back}
      {id ? (
        <EditExisting id={id} categories={categories} />
      ) : (
        <CreateNew categories={categories} />
      )}
    </>
  );
}

function CreateNew({ categories }: { categories: ReturnType<typeof flattenCategories> }) {
  const { t } = useLocale();
  const vendorCurrency = useVendorCurrency();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useApiMutation(
    (body: ProductUpsert, headers) =>
      unwrap(
        api.POST('/v1/vendor/products', { params: { header: headers }, body: toRequestBody(body) }),
      ).then((data) => VendorProductSchema.parse(data)),
    {
      onSuccess: async (product) => {
        await queryClient.invalidateQueries({ queryKey: ['vendor', 'products'] });
        toast.success(t('admin.vendor.form.created'));
        void navigate(`/vendor/products/${product.id}`, { replace: true });
      },
    },
  );
  return (
    <>
      <PageHeader title={t('admin.vendor.products.new')} />
      {create.error ? <ErrorAlert className="mb-4" error={create.error} /> : null}
      {vendorCurrency.isPending ? (
        <p role="status" className="py-8 text-center text-body-s text-text-muted">
          {t('admin.table.loading')}
        </p>
      ) : (
        <ProductForm
          initial={emptyProductForm(vendorCurrency.currency ?? 'VND')}
          categories={categories}
          isNew
          readOnly={false}
          currencies={currencyOptions(vendorCurrency.currency)}
          submitting={create.isPending}
          onSubmit={(value) => create.mutate(value)}
          uploadImage={(file) => uploadFile(api, file, 'product-image')}
        />
      )}
    </>
  );
}

function EditExisting({
  id,
  categories,
}: {
  id: string;
  categories: ReturnType<typeof flattenCategories>;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const queryKey = ['vendor', 'product', id];
  const [formVersion, setFormVersion] = useState(0);

  const query = useQuery({
    queryKey,
    queryFn: () =>
      unwrap(api.GET('/v1/vendor/products/{id}', { params: { path: { id } } })).then((data) =>
        VendorProductSchema.parse(data),
      ),
  });

  const refreshList = () => queryClient.invalidateQueries({ queryKey: ['vendor', 'products'] });
  const store = (product: VendorProduct) => {
    queryClient.setQueryData(queryKey, product);
    void refreshList();
  };

  const save = useApiMutation(
    (body: ProductUpsert, headers) =>
      unwrap(
        api.PUT('/v1/vendor/products/{id}', {
          params: { path: { id }, header: headers },
          body: toRequestBody(body),
        }),
      ).then((data) => VendorProductSchema.parse(data)),
    {
      onSuccess: (product) => {
        store(product);
        setFormVersion((version) => version + 1); // remount: new variants/images now have ids
        toast.success(t('admin.vendor.form.saved'));
      },
    },
  );
  const publish = useApiMutation(
    (_: void, headers) =>
      unwrap(
        api.POST('/v1/vendor/products/{id}/publish', { params: { path: { id }, header: headers } }),
      ).then((data) => VendorProductSchema.parse(data)),
    {
      onSuccess: (product) => {
        store(product);
        toast.success(t('admin.vendor.products.published'));
      },
    },
  );
  const archive = useApiMutation(
    (_: void, headers) =>
      unwrap(
        api.POST('/v1/vendor/products/{id}/archive', { params: { path: { id }, header: headers } }),
      ).then((data) => VendorProductSchema.parse(data)),
    {
      onSuccess: (product) => {
        store(product);
        toast.success(t('admin.vendor.products.archived'));
      },
    },
  );
  const stock = useApiMutation(
    (variables: { variantId: string; stockOnHand: number }, headers) =>
      unwrap(
        api.PATCH('/v1/vendor/variants/{id}/stock', {
          params: { path: { id: variables.variantId }, header: headers },
          body: { stockOnHand: variables.stockOnHand },
        }),
      ),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey });
        void refreshList();
        toast.success(t('admin.vendor.form.stockSaved'));
      },
    },
  );

  if (query.error) return <ErrorAlert error={query.error} />;
  const product = query.data;
  if (!product) {
    return (
      <p role="status" className="py-8 text-center text-body-s text-text-muted">
        {t('admin.table.loading')}
      </p>
    );
  }

  const blocked = product.status === 'BLOCKED';
  const actionError = save.error ?? publish.error ?? archive.error ?? stock.error;
  const name = product.translations.find((item) => item.locale === 'VI')?.name ?? '';

  return (
    <>
      <PageHeader
        title={name}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ProductStatusBadge status={product.status} />
            {!blocked && product.status !== 'ACTIVE' ? (
              <Button loading={publish.isPending} onClick={() => publish.mutate()}>
                {t('admin.vendor.products.publish')}
              </Button>
            ) : null}
            {!blocked && product.status !== 'ARCHIVED' ? (
              <Button
                variant="secondary"
                loading={archive.isPending}
                onClick={() => archive.mutate()}
              >
                {t('admin.vendor.products.archive')}
              </Button>
            ) : null}
          </div>
        }
      />
      {blocked ? (
        <Alert variant="danger" className="mb-4">
          <AlertDescription>
            <strong>{t('admin.vendor.products.blockedTitle')}</strong>{' '}
            {product.blockedReason ?? t('admin.vendor.products.blockedNoReason')}
          </AlertDescription>
        </Alert>
      ) : null}
      {actionError ? <ErrorAlert className="mb-4" error={actionError} /> : null}
      <ProductForm
        key={`${product.id}:${formVersion}`}
        initial={fromProduct(product)}
        categories={categories}
        isNew={false}
        readOnly={blocked}
        submitting={save.isPending}
        onSubmit={(value) => save.mutate(value)}
        uploadImage={(file) => uploadFile(api, file, 'product-image')}
        onQuickStock={(variantId, stockOnHand) => stock.mutate({ variantId, stockOnHand })}
        quickStockPending={stock.isPending}
      />
    </>
  );
}
