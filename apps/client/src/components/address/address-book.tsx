'use client';

import * as React from 'react';
import { Alert, AlertDescription, Badge, Button, Card } from '@repo/ui';
import type { Address } from '@repo/core';
import { deleteAddress, listAddresses, setDefaultAddress } from '@/lib/api/account';
import { describeError } from '@/lib/api/error-message';
import { sortAddresses, withDefault, withoutAddress } from '@/lib/addresses';
import { newIdempotencyKey } from '@/lib/idempotency';
import { useLocale } from '@/i18n/use-locale';
import { AddressForm } from './address-form';

type Editing = { kind: 'new' } | { kind: 'edit'; id: string } | null;

/** `/account/addresses`: list (default first), add, edit, delete, set default. */
export function AddressBook() {
  const { locale, t } = useLocale();
  const [addresses, setAddresses] = React.useState<Address[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [editing, setEditing] = React.useState<Editing>(null);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoadError(false);
    try {
      setAddresses(sortAddresses(await listAddresses()));
    } catch {
      setLoadError(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  /** Re-read after a create (a new default demotes the old one) — cheaper than mirroring the rules. */
  const saved = () => {
    setEditing(null);
    void load();
  };

  const makeDefault = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await setDefaultAddress(id, newIdempotencyKey());
      setAddresses((prev) => (prev ? withDefault(prev, id) : prev));
    } catch (error) {
      setActionError(describeError(locale, error));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try {
      await deleteAddress(id);
      setConfirmingId(null);
      setAddresses((prev) => (prev ? withoutAddress(prev, id) : prev));
    } catch (error) {
      setActionError(describeError(locale, error));
    } finally {
      setBusyId(null);
    }
  };

  if (loadError) {
    return (
      <Alert variant="danger">
        <AlertDescription>
          {t('addr.loadFailed')}{' '}
          <Button variant="link" size="sm" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!addresses) {
    return (
      <p role="status" aria-busy className="text-body-m text-text-muted">
        {t('common.loading')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-h6 font-semibold text-text-primary">{t('addr.title')}</h2>
        {editing?.kind === 'new' ? null : (
          <Button size="md" onClick={() => setEditing({ kind: 'new' })}>
            {t('addr.add')}
          </Button>
        )}
      </div>

      {actionError ? (
        <Alert variant="danger">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      {editing?.kind === 'new' ? (
        <Card className="p-5">
          <h3 className="mb-4 text-body-l font-semibold text-text-primary">
            {t('addr.formAddTitle')}
          </h3>
          <AddressForm onSaved={saved} onCancel={() => setEditing(null)} />
        </Card>
      ) : null}

      {addresses.length === 0 && editing === null ? (
        <p className="text-body-m text-text-muted">{t('addr.empty')}</p>
      ) : null}

      <ul className="flex flex-col gap-4">
        {addresses.map((address) => {
          const isEditing = editing?.kind === 'edit' && editing.id === address.id;
          const busy = busyId === address.id;
          return (
            <li key={address.id}>
              <Card className="p-5">
                {isEditing ? (
                  <>
                    <h3 className="mb-4 text-body-l font-semibold text-text-primary">
                      {t('addr.formEditTitle')}
                    </h3>
                    <AddressForm
                      initial={address}
                      onSaved={(next) => {
                        setAddresses((prev) =>
                          prev
                            ? sortAddresses(prev.map((a) => (a.id === next.id ? next : a)))
                            : prev,
                        );
                        setEditing(null);
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </>
                ) : (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <address className="flex flex-col gap-0.5 text-body-m not-italic text-text-body">
                      <span className="flex items-center gap-2 font-semibold text-text-primary">
                        {address.recipientName}
                        {address.isDefault ? (
                          <Badge variant="info">{t('addr.defaultBadge')}</Badge>
                        ) : null}
                      </span>
                      <span>{address.phone}</span>
                      <span>{[address.line1, address.line2].filter(Boolean).join(', ')}</span>
                      <span>{[address.ward, address.district, address.city].join(', ')}</span>
                      <span>{address.country}</span>
                    </address>
                    <div className="flex flex-wrap items-center gap-2">
                      {address.isDefault ? null : (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          onClick={() => void makeDefault(address.id)}
                        >
                          {t('addr.setDefault')}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => setEditing({ kind: 'edit', id: address.id })}
                      >
                        {t('addr.edit')}
                      </Button>
                      {confirmingId === address.id ? (
                        <>
                          <span className="text-body-s text-text-muted">
                            {t('addr.deleteConfirm')}
                          </span>
                          <Button
                            variant="destructive"
                            size="sm"
                            loading={busy}
                            onClick={() => void remove(address.id)}
                          >
                            {busy ? t('addr.deleting') : t('addr.delete')}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => setConfirmingId(null)}
                          >
                            {t('addr.cancel')}
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirmingId(address.id)}
                        >
                          {t('addr.delete')}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
