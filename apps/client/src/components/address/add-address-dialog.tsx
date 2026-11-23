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
import { AddressForm } from './address-form';

/** "Add address" button + dialog around `AddressForm`; calls `onCreated` with the saved address. */
export function AddAddressDialog({
  onCreated,
  variant = 'secondary',
}: {
  onCreated: (address: Address) => void;
  variant?: 'secondary' | 'primary';
}) {
  const { t } = useLocale();
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          onCancel={() => setOpen(false)}
          onSaved={(address) => {
            setOpen(false);
            onCreated(address);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
