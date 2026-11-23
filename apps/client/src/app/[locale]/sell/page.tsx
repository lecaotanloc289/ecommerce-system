import type { Metadata } from 'next';
import { createTranslator } from '@repo/i18n';
import { pageLocale } from '@/i18n/page-locale';
import { SellContent } from '@/components/sell/sell-content';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = createTranslator(await pageLocale(params));
  return { title: `${t('sell.title')} | ${t('common.brand')}`, description: t('sell.intro') };
}

export default async function SellPage({ params }: Props) {
  await pageLocale(params);
  return <SellContent />;
}
