'use client';

import { Link } from '@/i18n/navigation';
import { Facebook, Github, Instagram, Linkedin, Twitter } from 'lucide-react';
import { Container } from './container';
import { useT } from '../../i18n/use-locale';
import type { MessageKey } from '../../i18n/use-locale';

/** Links without `href` have no page yet — rendered as plain text, not dead links. */
const columns: { title: MessageKey; links: { label: MessageKey; href?: string }[] }[] = [
  {
    title: 'footer.shop',
    links: [
      { label: 'footer.allCategories', href: '/categories' },
      { label: 'footer.allProducts', href: '/search' },
      { label: 'footer.cart', href: '/cart' },
      { label: 'footer.trackOrder', href: '/order/track' },
    ],
  },
  {
    title: 'footer.company',
    links: [
      { label: 'footer.about' },
      { label: 'footer.careers' },
      { label: 'footer.contact' },
      { label: 'footer.blog' },
    ],
  },
  {
    title: 'footer.support',
    links: [
      { label: 'footer.shipping' },
      { label: 'footer.returns' },
      { label: 'footer.faq' },
      { label: 'footer.paymentMethods' },
    ],
  },
  {
    title: 'footer.legal',
    links: [{ label: 'footer.privacy' }, { label: 'footer.terms' }, { label: 'footer.cookies' }],
  },
];

const socials: { icon: typeof Facebook; label: MessageKey }[] = [
  { icon: Facebook, label: 'social.facebook' },
  { icon: Twitter, label: 'social.twitter' },
  { icon: Linkedin, label: 'social.linkedin' },
  { icon: Instagram, label: 'social.instagram' },
  { icon: Github, label: 'social.github' },
];

export function Footer() {
  const t = useT();

  return (
    <footer className="mt-16 border-t border-border-faint bg-bg-muted/40">
      <Container className="py-12 lg:py-16">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <span className="font-heading text-h4 font-bold tracking-tight text-text-primary">
              {t('common.brand')}
            </span>
          </div>

          {/* Link columns */}
          {columns.map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <h3 className="text-body-m font-semibold text-text-primary">{t(col.title)}</h3>
              <ul className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.href ? (
                      <Link
                        href={link.href}
                        className="text-body-m text-text-muted transition-colors hover:text-brand-text"
                      >
                        {t(link.label)}
                      </Link>
                    ) : (
                      <span className="text-body-m text-text-muted">{t(link.label)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-border-faint pt-6 sm:flex-row">
          {/* Year is computed at prerender/SSR time and again in the browser. */}
          <p className="text-body-s text-text-muted" suppressHydrationWarning>
            {t('footer.rights', { year: new Date().getFullYear() })}
          </p>
          {/* No profile URLs yet — icons only, not links. */}
          <div className="flex items-center gap-1">
            {socials.map(({ icon: Icon, label }) => (
              <span
                key={label}
                role="img"
                aria-label={t(label)}
                className="inline-flex size-9 items-center justify-center text-text-muted"
              >
                <Icon className="size-4" aria-hidden />
              </span>
            ))}
          </div>
        </div>
      </Container>
    </footer>
  );
}
