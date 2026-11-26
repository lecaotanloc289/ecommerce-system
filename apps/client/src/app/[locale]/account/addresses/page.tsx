import type { Metadata } from 'next';
import { createTranslator } from '@repo/i18n';
import { pageLocale } from '@/i18n/page-locale';
import { AccountShell } from '@/components/account/account-shell';
import { AddressBook } from '@/components/address/address-book';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = createTranslator(await pageLocale(params));
  return { title: `${t('addr.title')} | ${t('common.brand')}`, robots: { index: false } };
}

export default async function AddressesPage({ params }: Props) {
  await pageLocale(params);
  return (
    <AccountShell title="account.addresses">
      <AddressBook />
    </AccountShell>
  );
}
