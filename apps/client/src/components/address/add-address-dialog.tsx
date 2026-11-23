'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui';
import type { Address } from '@repo/core';
import { useLocale } from '../../i18n/use-locale';
import { createAddress } from '../../lib/api/commerce';
import { describeError } from '../../lib/api/errors';
import { AddressForm } from './address-form';

/** "Add address" button + dialog around `AddressForm`; calls `onCreated` with the saved address. */
export function AddAddressDialog({
  onCreated,
  variant = 'secondary',
}: {
  onCreated: (address: Address) => void;
  variant?: 'secondary' | 'primary';
}) {
  const { locale, t } = useLocale();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant={variant} iconLeft={<Plus className="size-4" />}>
          {t('checkout.addAddress')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('addressForm.dialogTitle')}</DialogTitle>
          <DialogDescription className="sr-only">{t('addressForm.dialogTitle')}</DialogDescription>
        </DialogHeader>
        <AddressForm
          submitting={submitting}
          error={error}
          onCancel={() => setOpen(false)}
          onSubmit={async (input) => {
            setSubmitting(true);
            setError(null);
            try {
              const address = await createAddress(input);
              setOpen(false);
              onCreated(address);
            } catch (e) {
              setError(describeError(locale, e));
            } finally {
              setSubmitting(false);
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
