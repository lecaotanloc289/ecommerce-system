'use client';

import * as React from 'react';
import { RadioGroup, RadioGroupItem } from '@repo/ui';
import type { Address } from '@repo/core';
import { useLocale } from '../../i18n/use-locale';
import { fetchAddresses } from '../../lib/api/commerce';
import { AddAddressDialog } from '../address/add-address-dialog';
import { AddressLines } from '../address/address-lines';
import { useCheckout } from '../../store/checkout-store';

/** The address to preselect: the customer's earlier pick if it still exists, else the default. */
export function pickAddress(addresses: readonly Address[], current: string | null): string | null {
  return (
    addresses.find((a) => a.id === current)?.id ??
    addresses.find((a) => a.isDefault)?.id ??
    addresses[0]?.id ??
    null
  );
}

/**
 * Checkout address step: the saved address book as radio cards + "add address" dialog. The
 * chosen id lives in the checkout store; the API snapshots the address when the order is placed.
 */
export function AddressPicker() {
  const { t } = useLocale();
  const { choices, setAddressId, hydrated } = useCheckout();
  const [addresses, setAddresses] = React.useState<Address[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const currentRef = React.useRef(choices.addressId);
  currentRef.current = choices.addressId;

  React.useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    fetchAddresses().then(
      (list) => {
        if (cancelled) return;
        setAddresses(list);
        setAddressId(pickAddress(list, currentRef.current));
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [hydrated, setAddressId]);

  const onCreated = (address: Address) => {
    setAddresses((list) => [
      address,
      ...(list ?? []).map((a) => (address.isDefault ? { ...a, isDefault: false } : a)),
    ]);
    setAddressId(address.id);
  };

  if (failed) {
    return (
      <p role="alert" className="text-body-m text-danger-fg">
        {t('checkout.addressesFailed')}
      </p>
    );
  }
  if (!addresses) {
    return (
      <p role="status" className="text-body-m text-text-muted">
        {t('checkout.loadingAddresses')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {addresses.length === 0 ? (
        <p className="text-body-m text-text-muted">{t('checkout.noAddresses')}</p>
      ) : (
        <RadioGroup
          value={choices.addressId ?? ''}
          onValueChange={setAddressId}
          aria-label={t('checkout.savedAddresses')}
          className="flex flex-col gap-3"
        >
          {addresses.map((a) => (
            <label
              key={a.id}
              htmlFor={`address-${a.id}`}
              className="flex cursor-pointer items-start gap-4 rounded-lg border border-border-default bg-bg-elevated p-4 transition-colors hover:border-border-strong has-[:checked]:border-brand-solid has-[:checked]:bg-brand-soft/40"
            >
              <RadioGroupItem id={`address-${a.id}`} value={a.id} className="mt-1" />
              <div className="flex-1">
                <AddressLines address={a} />
              </div>
              {a.isDefault ? (
                <span className="rounded-full bg-success-bg px-2.5 py-1 text-body-s font-medium text-success-fg">
                  {t('checkout.defaultAddress')}
                </span>
              ) : null}
            </label>
          ))}
        </RadioGroup>
      )}
      <div>
        <AddAddressDialog
          onCreated={onCreated}
          variant={addresses.length === 0 ? 'primary' : 'secondary'}
        />
      </div>
    </div>
  );
}
