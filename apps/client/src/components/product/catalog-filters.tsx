'use client';

import * as React from 'react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui';
import { PRODUCT_SORTS, type Currency, type ProductSort } from '@repo/core';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useT, type MessageKey } from '../../i18n/use-locale';
import {
  catalogFiltersToQuery,
  toMajorUnits,
  toMinorUnits,
  type CatalogFilters,
} from '../../lib/catalog-query';

const SORT_LABEL: Record<ProductSort, MessageKey> = {
  newest: 'search.newest',
  price_asc: 'search.priceLow',
  price_desc: 'search.priceHigh',
  rating: 'search.topRated',
};
const SORTS = PRODUCT_SORTS;

/** Navigate to the current path with new filters (the RSC page re-renders with them). */
function useApplyFilters(currency: Currency) {
  const router = useRouter();
  const pathname = usePathname();
  return (filters: CatalogFilters) => {
    const query = new URLSearchParams(catalogFiltersToQuery(filters, currency)).toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };
}

/** Sort dropdown for catalog lists (`GET /v1/products?sort=`). */
export function SortSelect({ filters, currency }: { filters: CatalogFilters; currency: Currency }) {
  const t = useT();
  const apply = useApplyFilters(currency);
  return (
    <Select
      value={filters.sort}
      onValueChange={(value) => {
        const sort = SORTS.find((s) => s === value);
        if (sort) apply({ ...filters, sort });
      }}
    >
      <SelectTrigger className="w-48" aria-label={t('search.sortBy')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SORTS.map((s) => (
          <SelectItem key={s} value={s}>
            {t(SORT_LABEL[s])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function parseWhole(value: string): number | undefined {
  const trimmed = value.trim();
  return /^\d{1,12}$/.test(trimmed) ? Number(trimmed) : undefined;
}

/**
 * Price range in whole major units of `currency` (what shoppers type); converted to integer
 * minor units for the API (Golden Rule #2).
 */
export function PriceFilter({
  filters,
  currency,
}: {
  filters: CatalogFilters;
  currency: Currency;
}) {
  const t = useT();
  const ids = React.useId();
  const apply = useApplyFilters(currency);
  const initial = (minor: number | undefined) =>
    minor === undefined ? '' : String(toMajorUnits(minor, currency));
  const [min, setMin] = React.useState(initial(filters.minPrice));
  const [max, setMax] = React.useState(initial(filters.maxPrice));

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const minMajor = parseWhole(min);
    const maxMajor = parseWhole(max);
    const next: CatalogFilters = { sort: filters.sort };
    if (minMajor !== undefined) next.minPrice = toMinorUnits(minMajor, currency);
    if (maxMajor !== undefined) next.maxPrice = toMinorUnits(maxMajor, currency);
    apply(next);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-body-m font-semibold text-text-primary">
          {t('catalog.priceRange', { currency })}
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-min`}>{t('catalog.minPrice')}</Label>
            <Input
              id={`${ids}-min`}
              inputMode="numeric"
              pattern="[0-9]*"
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-max`}>{t('catalog.maxPrice')}</Label>
            <Input
              id={`${ids}-max`}
              inputMode="numeric"
              pattern="[0-9]*"
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </div>
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" size="md">
          {t('common.apply')}
        </Button>
        <Button
          type="button"
          size="md"
          variant="ghost"
          onClick={() => {
            setMin('');
            setMax('');
            apply({ sort: filters.sort });
          }}
        >
          {t('catalog.clearFilters')}
        </Button>
      </div>
    </form>
  );
}
