import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Currency, ProductUpsert } from '@repo/core';
import { Button, Checkbox, Input, Label, Textarea } from '@repo/ui';
import { FormField } from '@/components/form-field';
import { ImageListEditor } from '@/components/image-list-editor';
import { MoneyInput } from '@/components/money-input';
import { useT } from '@/i18n/use-locale';
import {
  emptyVariant,
  parseStock,
  slugify,
  validateProduct,
  type FormErrors,
  type ProductFormState,
} from './product-form-model';

export interface CategoryOption {
  id: string;
  name: string;
  depth: number;
}

const MAX_IMAGES = 20;
const CURRENCIES: readonly Currency[] = ['VND', 'USD'];

/**
 * Product editor. Validation lives in `validateProduct` (vi + en required, stock ≥ reserved,
 * exact price parse); `readOnly` is used for BLOCKED products. `onQuickStock` updates one existing
 * variant's stock on its own (`PATCH /v1/vendor/variants/:id/stock`).
 */
export function ProductForm({
  initial,
  categories,
  isNew,
  readOnly,
  submitting,
  onSubmit,
  uploadImage,
  onQuickStock,
  quickStockPending,
}: {
  initial: ProductFormState;
  categories: readonly CategoryOption[];
  isNew: boolean;
  readOnly: boolean;
  submitting: boolean;
  onSubmit: (value: ProductUpsert) => void;
  uploadImage: (file: File) => Promise<string>;
  onQuickStock?: (variantId: string, stockOnHand: number) => void;
  quickStockPending?: boolean;
}) {
  const t = useT();
  const [state, setState] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});

  const patch = (changes: Partial<ProductFormState>) =>
    setState((prev) => ({ ...prev, ...changes }));
  const message = (field: string) => {
    const error = errors[field];
    return error ? t(error.key, error.params) : undefined;
  };

  const setName = (locale: 'Vi' | 'En', name: string) => {
    const nameKey = `name${locale}` as const;
    const slugKey = `slug${locale}` as const;
    // Keep the slug following the name until the vendor edits it by hand.
    const follows = state[slugKey] === '' || state[slugKey] === slugify(state[nameKey]);
    patch({ [nameKey]: name, ...(follows ? { [slugKey]: slugify(name) } : {}) });
  };

  const setVariant = (rowId: string, changes: Partial<ProductFormState['variants'][number]>) =>
    patch({
      variants: state.variants.map((row) => (row.rowId === rowId ? { ...row, ...changes } : row)),
    });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (readOnly) return;
    const result = validateProduct(state);
    setErrors(result.ok ? {} : result.errors);
    if (result.ok) onSubmit(result.value);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-8">
      {errors.form ? (
        <p role="alert" className="text-body-s text-danger-fg">
          {t(errors.form.key)}
        </p>
      ) : null}

      <section
        className="grid gap-6 md:grid-cols-2"
        aria-label={t('admin.vendor.form.translations')}
      >
        {(['Vi', 'En'] as const).map((locale) => (
          <fieldset
            key={locale}
            disabled={readOnly}
            className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-bg-elevated p-4"
          >
            <legend className="px-1 text-body-s font-semibold text-text-primary">
              {locale === 'Vi' ? t('admin.vendor.form.langVi') : t('admin.vendor.form.langEn')}
            </legend>
            <FormField
              id={`name${locale}`}
              label={t('admin.vendor.form.name')}
              error={message(`name${locale}`)}
            >
              <Input
                id={`name${locale}`}
                value={state[`name${locale}`]}
                invalid={Boolean(errors[`name${locale}`])}
                onChange={(event) => setName(locale, event.target.value)}
              />
            </FormField>
            <FormField
              id={`slug${locale}`}
              label={t('admin.vendor.form.slug')}
              error={message(`slug${locale}`)}
              hint={t('admin.vendor.form.slugHint')}
            >
              <Input
                id={`slug${locale}`}
                value={state[`slug${locale}`]}
                invalid={Boolean(errors[`slug${locale}`])}
                onChange={(event) => patch({ [`slug${locale}`]: event.target.value })}
              />
            </FormField>
            <FormField id={`description${locale}`} label={t('admin.vendor.form.description')}>
              <Textarea
                id={`description${locale}`}
                value={state[`description${locale}`]}
                onChange={(event) => patch({ [`description${locale}`]: event.target.value })}
              />
            </FormField>
          </fieldset>
        ))}
      </section>

      <section className="flex flex-col gap-3" aria-label={t('admin.vendor.form.variants')}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-heading text-body-l font-semibold text-text-primary">
            {t('admin.vendor.form.variants')}
          </h2>
          {isNew && !readOnly ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="currency">{t('admin.vendor.form.currency')}</Label>
              <select
                id="currency"
                value={state.currency}
                className="h-10 rounded-md border border-border-input bg-bg-elevated px-3 text-body-m"
                onChange={(event) => {
                  const next = CURRENCIES.find((currency) => currency === event.target.value);
                  if (next) patch({ currency: next });
                }}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <span className="text-body-s text-text-muted">{state.currency}</span>
          )}
        </div>
        {message('variants') ? (
          <p role="alert" className="text-caption text-danger-fg">
            {message('variants')}
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          {state.variants.map((row, index) => {
            const at = (field: string) => `variants.${index}.${field}`;
            const quickStock = parseStock(row.stock);
            return (
              <div
                key={row.rowId}
                role="group"
                aria-label={t('admin.vendor.form.variantN', { n: index + 1 })}
                className="grid gap-3 rounded-lg border border-border-subtle bg-bg-elevated p-4 md:grid-cols-[1fr_1.4fr_1fr_1fr_auto]"
              >
                <FormField
                  id={`sku-${row.rowId}`}
                  label={t('admin.vendor.form.sku')}
                  error={message(at('sku'))}
                >
                  <Input
                    id={`sku-${row.rowId}`}
                    value={row.sku}
                    disabled={readOnly}
                    invalid={Boolean(errors[at('sku')])}
                    onChange={(event) => setVariant(row.rowId, { sku: event.target.value })}
                  />
                </FormField>
                <FormField
                  id={`attrs-${row.rowId}`}
                  label={t('admin.vendor.form.attributes')}
                  error={message(at('attributes'))}
                  hint={t('admin.vendor.form.attributesHint')}
                >
                  <Input
                    id={`attrs-${row.rowId}`}
                    value={row.attributes}
                    disabled={readOnly}
                    invalid={Boolean(errors[at('attributes')])}
                    onChange={(event) => setVariant(row.rowId, { attributes: event.target.value })}
                  />
                </FormField>
                <FormField
                  id={`price-${row.rowId}`}
                  label={t('admin.vendor.form.price')}
                  error={message(at('price'))}
                >
                  <MoneyInput
                    id={`price-${row.rowId}`}
                    label={t('admin.vendor.form.price')}
                    value={row.price}
                    currency={state.currency}
                    disabled={readOnly}
                    onChange={(price) => setVariant(row.rowId, { price })}
                  />
                </FormField>
                <FormField
                  id={`stock-${row.rowId}`}
                  label={t('admin.vendor.form.stock')}
                  error={message(at('stock'))}
                  hint={
                    row.id
                      ? t('admin.vendor.form.reserved', { count: row.stockReserved })
                      : undefined
                  }
                >
                  <Input
                    id={`stock-${row.rowId}`}
                    inputMode="numeric"
                    value={row.stock}
                    disabled={readOnly}
                    invalid={Boolean(errors[at('stock')])}
                    onChange={(event) => setVariant(row.rowId, { stock: event.target.value })}
                  />
                </FormField>
                <div className="flex items-end gap-1">
                  {row.id && onQuickStock && !readOnly ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={
                        quickStockPending === true ||
                        quickStock === null ||
                        quickStock < row.stockReserved
                      }
                      aria-label={t('admin.vendor.form.saveStockFor', { sku: row.sku })}
                      onClick={() => {
                        if (row.id && quickStock !== null) onQuickStock(row.id, quickStock);
                      }}
                    >
                      {t('admin.vendor.form.saveStock')}
                    </Button>
                  ) : null}
                  {!readOnly && state.variants.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('admin.vendor.form.removeVariant')}
                      onClick={() =>
                        patch({
                          variants: state.variants.filter((item) => item.rowId !== row.rowId),
                        })
                      }
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        {!readOnly ? (
          <Button
            type="button"
            variant="secondary"
            className="self-start"
            iconLeft={<Plus aria-hidden />}
            onClick={() => patch({ variants: [...state.variants, emptyVariant()] })}
          >
            {t('admin.vendor.form.addVariant')}
          </Button>
        ) : null}
      </section>

      <section className="flex flex-col gap-3" aria-label={t('admin.vendor.form.images')}>
        <h2 className="font-heading text-body-l font-semibold text-text-primary">
          {t('admin.vendor.form.images')}
        </h2>
        <ImageListEditor
          images={state.images}
          onChange={(images) => patch({ images })}
          onAppend={(added) =>
            setState((prev) => ({ ...prev, images: [...prev.images, ...added] }))
          }
          upload={uploadImage}
          maxImages={MAX_IMAGES}
          disabled={readOnly}
        />
      </section>

      <section className="flex flex-col gap-3" aria-label={t('admin.vendor.form.categories')}>
        <h2 className="font-heading text-body-l font-semibold text-text-primary">
          {t('admin.vendor.form.categories')}
        </h2>
        {message('categoryIds') ? (
          <p role="alert" className="text-caption text-danger-fg">
            {message('categoryIds')}
          </p>
        ) : null}
        <ul className="grid gap-2 sm:grid-cols-2">
          {categories.map((category) => {
            const checked = state.categoryIds.includes(category.id);
            const id = `category-${category.id}`;
            return (
              <li
                key={category.id}
                className="flex items-center gap-2"
                style={{ paddingLeft: `${category.depth * 16}px` }}
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={readOnly}
                  onCheckedChange={(next) =>
                    patch({
                      categoryIds:
                        next === true
                          ? [...state.categoryIds, category.id]
                          : state.categoryIds.filter((value) => value !== category.id),
                    })
                  }
                />
                <Label htmlFor={id}>{category.name}</Label>
              </li>
            );
          })}
        </ul>
      </section>

      {!readOnly ? (
        <div className="flex justify-end">
          <Button type="submit" loading={submitting}>
            {isNew ? t('admin.vendor.form.create') : t('admin.vendor.form.save')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
