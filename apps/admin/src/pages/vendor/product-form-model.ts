import {
  ProductUpsertSchema,
  type Currency,
  type ProductUpsert,
  type VendorProduct,
} from '@repo/core';
import type { MessageKey } from '@repo/i18n';
import type { ImageItem } from '@/components/image-list-editor';
import { formatMoneyInput, parseMoneyInput } from '@/lib/money-input';
import { newRowId } from '@/lib/row-id';

// Form state for the product editor, kept apart from React so validation is unit-tested.
// Everything a person types stays text until `validateProduct` turns it into a `ProductUpsert`.

export const MAX_STOCK = 2_147_483_647;

export interface VariantRow {
  /** Stable React key (not sent to the API). */
  rowId: string;
  /** Present for a variant that already exists — keeps its id so the API updates it in place. */
  id?: string;
  sku: string;
  /** `key=value, key=value` (see `parseAttributes`). */
  attributes: string;
  price: string;
  stock: string;
  /** Units held by open orders; stock cannot go below this. 0 for a new variant. */
  stockReserved: number;
}

/** Existing image (`id`, kept) or a file uploaded in this session (`key`). */
export type ImageRow = ImageItem;

export interface ProductFormState {
  currency: Currency;
  nameVi: string;
  slugVi: string;
  descriptionVi: string;
  nameEn: string;
  slugEn: string;
  descriptionEn: string;
  variants: VariantRow[];
  images: ImageRow[];
  categoryIds: string[];
}

export function emptyVariant(): VariantRow {
  return { rowId: newRowId(), sku: '', attributes: '', price: '', stock: '0', stockReserved: 0 };
}

export function emptyProductForm(currency: Currency): ProductFormState {
  return {
    currency,
    nameVi: '',
    slugVi: '',
    descriptionVi: '',
    nameEn: '',
    slugEn: '',
    descriptionEn: '',
    variants: [emptyVariant()],
    images: [],
    categoryIds: [],
  };
}

/** Lowercase ASCII slug; Vietnamese diacritics (incl. đ) are transliterated first. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `Color=Red, Size=M` → `{ Color: 'Red', Size: 'M' }`; `null` when a pair is malformed. */
export function parseAttributes(text: string): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const part of text.split(',')) {
    if (part.trim() === '') continue;
    const index = part.indexOf('=');
    const key = index < 0 ? '' : part.slice(0, index).trim();
    if (key === '') return null;
    result[key] = part.slice(index + 1).trim();
  }
  return result;
}

export function formatAttributes(attributes: Readonly<Record<string, string>>): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

export function fromProduct(product: VendorProduct): ProductFormState {
  const translation = (locale: 'VI' | 'EN') =>
    product.translations.find((item) => item.locale === locale);
  const vi = translation('VI');
  const en = translation('EN');
  return {
    currency: product.basePrice.currency,
    nameVi: vi?.name ?? '',
    slugVi: vi?.slug ?? '',
    descriptionVi: vi?.description ?? '',
    nameEn: en?.name ?? '',
    slugEn: en?.slug ?? '',
    descriptionEn: en?.description ?? '',
    variants: product.variants.map((variant) => ({
      rowId: newRowId(),
      id: variant.id,
      sku: variant.sku,
      attributes: formatAttributes(variant.attributes),
      price: formatMoneyInput(variant.price.amount, variant.price.currency),
      stock: String(variant.stockOnHand),
      stockReserved: variant.stockReserved,
    })),
    images: [...product.images]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => ({
        rowId: newRowId(),
        id: image.id,
        url: image.url,
        alt: image.alt ?? '',
      })),
    categoryIds: [...product.categoryIds],
  };
}

export interface FieldError {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/** Errors by field path: `nameVi`, `variants.2.stock`, `categoryIds`, `form` (schema fallback). */
export type FormErrors = Record<string, FieldError>;

export type ValidationResult =
  | { ok: true; value: ProductUpsert }
  | { ok: false; errors: FormErrors };

/** Stock text → non-negative int within Postgres int4, or `null`. */
export function parseStock(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value <= MAX_STOCK ? value : null;
}

export function validateProduct(state: ProductFormState): ValidationResult {
  const errors: FormErrors = {};
  const required = (field: string, value: string) => {
    if (value.trim() === '') errors[field] = { key: 'admin.vendor.form.error.required' };
  };

  required('nameVi', state.nameVi);
  required('nameEn', state.nameEn);
  required('slugVi', state.slugVi);
  required('slugEn', state.slugEn);
  if (state.categoryIds.length === 0) {
    errors.categoryIds = { key: 'admin.vendor.form.error.categories' };
  }
  if (state.variants.length === 0) errors.variants = { key: 'admin.vendor.form.error.variants' };

  const seenSkus = new Set<string>();
  // Plain objects: `ProductUpsertSchema.safeParse` below brands the ids and has the final say.
  const variants: {
    id?: string;
    sku: string;
    attributes: Record<string, string>;
    price: { amount: number; currency: Currency };
    stockOnHand: number;
  }[] = [];
  state.variants.forEach((row, index) => {
    const at = (field: string) => `variants.${index}.${field}`;
    const sku = row.sku.trim();
    if (sku === '') errors[at('sku')] = { key: 'admin.vendor.form.error.required' };
    else if (seenSkus.has(sku)) errors[at('sku')] = { key: 'admin.vendor.form.error.duplicateSku' };
    seenSkus.add(sku);

    const attributes = parseAttributes(row.attributes);
    if (attributes === null)
      errors[at('attributes')] = { key: 'admin.vendor.form.error.attributes' };

    const price = parseMoneyInput(row.price, state.currency);
    if (price === null) errors[at('price')] = { key: 'admin.vendor.form.error.price' };

    const stock = parseStock(row.stock);
    if (stock === null) errors[at('stock')] = { key: 'admin.vendor.form.error.stock' };
    else if (stock < row.stockReserved) {
      errors[at('stock')] = {
        key: 'admin.vendor.form.error.stockBelowReserved',
        params: { reserved: row.stockReserved },
      };
    }

    if (attributes !== null && price !== null && stock !== null) {
      variants.push({
        ...(row.id ? { id: row.id } : {}),
        sku,
        attributes,
        price: { amount: price, currency: state.currency },
        stockOnHand: stock,
      });
    }
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const description = (text: string) => (text.trim() === '' ? {} : { description: text.trim() });
  const candidate = {
    translations: [
      {
        locale: 'VI',
        name: state.nameVi,
        slug: state.slugVi.trim(),
        ...description(state.descriptionVi),
      },
      {
        locale: 'EN',
        name: state.nameEn,
        slug: state.slugEn.trim(),
        ...description(state.descriptionEn),
      },
    ],
    // The API stores the lowest variant price and only reads the currency from this.
    basePrice: {
      amount: Math.min(...variants.map((variant) => variant.price.amount)),
      currency: state.currency,
    },
    variants,
    images: state.images.map((image) => {
      const alt = image.alt.trim() === '' ? null : image.alt.trim();
      return image.id ? { id: image.id, alt } : { key: image.key, alt };
    }),
    categoryIds: state.categoryIds,
  };

  const parsed = ProductUpsertSchema.safeParse(candidate);
  if (!parsed.success) {
    // Field-level checks above cover the common cases; this catches the rest (slug shape, lengths).
    const slugIssue = parsed.error.issues.find((issue) => issue.path.includes('slug'));
    if (slugIssue) {
      const index = Number(slugIssue.path[1]);
      const field = index === 0 ? 'slugVi' : 'slugEn';
      return { ok: false, errors: { [field]: { key: 'admin.vendor.form.error.slug' } } };
    }
    return { ok: false, errors: { form: { key: 'admin.vendor.form.error.invalid' } } };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Request body for create / replace: the parsed upsert, with an absent description left out
 * (the generated client type does not accept an explicit `undefined`).
 */
export function toRequestBody(value: ProductUpsert) {
  return {
    ...value,
    translations: value.translations.map(({ description, ...rest }) =>
      description === undefined ? rest : { ...rest, description },
    ),
    variants: value.variants.map(({ id, ...rest }) => (id === undefined ? rest : { ...rest, id })),
  };
}
