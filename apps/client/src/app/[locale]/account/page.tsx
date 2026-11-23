import type { Metadata } from 'next';
import { createTranslator } from '@repo/i18n';
import { pageLocale } from '@/i18n/page-locale';
import { AccountShell } from '@/components/account/account-shell';
import { ProfileForm } from '@/components/account/profile-form';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = createTranslator(await pageLocale(params));
  return { title: `${t('account.title')} | ${t('common.brand')}`, robots: { index: false } };
}

export default async function AccountPage({ params }: Props) {
  await pageLocale(params);
  return (
    <AccountShell title="account.title">
      <ProfileForm />
    </AccountShell>
  );
}
