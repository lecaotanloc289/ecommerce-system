'use client';

import Link from 'next/link';
import { Facebook, Github, Instagram, Linkedin, Twitter } from 'lucide-react';
import { Container } from './container';
import { useT } from '../../i18n/locale-provider';
import type { MessageKey } from '../../i18n/locale-provider';

const columns: { title: MessageKey; links: MessageKey[] }[] = [
  {
    title: 'footer.shop',
    links: ['nav.categories', 'home.bestSeller', 'home.productList2', 'cart.youMayLike'],
  },
  {
    title: 'footer.company',
    links: ['footer.about', 'footer.careers', 'footer.contact', 'footer.faq'],
  },
  {
    title: 'footer.support',
    links: ['footer.shipping', 'footer.returns', 'footer.faq', 'footer.contact'],
  },
  {
    title: 'footer.legal',
    links: ['footer.privacy', 'footer.terms', 'footer.about', 'footer.contact'],
  },
];

const socials = [Facebook, Twitter, Linkedin, Instagram, Github];

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
                {col.links.map((link, i) => (
                  <li key={`${col.title}-${i}`}>
                    <Link
                      href="/"
                      className="text-body-m text-text-muted transition-colors hover:text-brand-text"
                    >
                      {t(link)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-border-faint pt-6 sm:flex-row">
          <p className="text-body-s text-text-muted">{t('footer.rights')}</p>
          <div className="flex items-center gap-1">
            {socials.map((Icon, i) => (
              <a
                key={i}
                href="#"
                aria-label="social link"
                className="inline-flex size-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-muted hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
              >
                <Icon className="size-4" />
              </a>
            ))}
          </div>
        </div>
      </Container>
    </footer>
  );
}
