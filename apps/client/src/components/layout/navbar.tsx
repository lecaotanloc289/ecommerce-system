'use client';

import * as React from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import {
  Facebook,
  Heart,
  Instagram,
  Menu,
  Search,
  ShoppingCart,
  Twitter,
  User,
} from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@repo/ui';
import { Container } from './container';
import { LocaleToggle } from './locale-toggle';
import { ThemeToggle } from './theme-toggle';
import { useT, type MessageKey } from '../../i18n/use-locale';
import { categories } from '../../mocks/categories';
import { useCart } from '../../store/cart-store';
import { cn } from '../../lib/utils';

/** Items without `href` have no page yet — rendered as disabled text, not dead links. */
const menuLinks: { key: MessageKey; href?: string }[] = [
  { key: 'nav.home', href: '/' },
  { key: 'nav.categories', href: '/categories' },
  { key: 'nav.shop', href: '/search' },
  { key: 'nav.blog' },
  { key: 'nav.pages' },
];

const socials: { icon: typeof Facebook; label: MessageKey }[] = [
  { icon: Facebook, label: 'social.facebook' },
  { icon: Twitter, label: 'social.twitter' },
  { icon: Instagram, label: 'social.instagram' },
];

export function Navbar() {
  const t = useT();
  const router = useRouter();
  const { itemCount: cartCount } = useCart();

  const onSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const q = form.get('q');
    const category = form.get('category');
    const params = new URLSearchParams();
    if (typeof q === 'string' && q.trim()) params.set('q', q.trim());
    if (typeof category === 'string' && category) params.set('category', category);
    const qs = params.toString();
    router.push(qs ? `/search?${qs}` : '/search');
  };

  return (
    <header className="sticky top-0 z-40 bg-bg-page">
      {/* Top utility bar */}
      <div className="hidden border-b border-border-faint bg-bg-muted/40 md:block">
        <Container className="flex h-9 items-center justify-between text-body-s text-text-muted">
          <div className="flex items-center gap-3">
            {/* No profile URLs yet — icons only, not links. */}
            {socials.map(({ icon: Icon, label }) => (
              <span key={label} role="img" aria-label={t(label)}>
                <Icon className="size-3.5" aria-hidden />
              </span>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <Link href="/order/track" className="hover:text-brand-text">
              {t('track.title')}
            </Link>
            <span>{t('footer.faq')}</span>
            <span className="h-3.5 w-px bg-border-default" />
            <LocaleToggle />
            <ThemeToggle className="size-7" />
          </div>
        </Container>
      </div>

      {/* Main bar */}
      <div className="border-b border-border-faint">
        <Container className="flex h-16 items-center gap-3 lg:h-20 lg:gap-6">
          {/* Hamburger menu (all sizes — kit hides nav behind it) */}
          <Drawer>
            <DrawerTrigger
              aria-label={t('nav.openMenu')}
              className="inline-flex size-9 items-center justify-center rounded-md text-text-body hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            >
              <Menu className="size-5" />
            </DrawerTrigger>
            <DrawerContent side="left" className="w-80 p-4">
              <DrawerHeader>
                <DrawerTitle className="font-heading text-h5">{t('common.brand')}</DrawerTitle>
              </DrawerHeader>
              <nav className="flex flex-col gap-1">
                {menuLinks.map((item) =>
                  item.href ? (
                    <Link
                      key={item.key}
                      href={item.href}
                      className="rounded-md px-3 py-2.5 text-body-m font-medium text-text-body hover:bg-bg-muted"
                    >
                      {t(item.key)}
                    </Link>
                  ) : (
                    <span
                      key={item.key}
                      className="px-3 py-2.5 text-body-m font-medium text-text-disabled"
                    >
                      {t(item.key)}
                    </span>
                  ),
                )}
              </nav>
              <div className="mt-4 border-t border-border-faint pt-4">
                <p className="mb-2 px-3 text-body-s font-semibold text-text-muted">
                  {t('nav.categories')}
                </p>
                {categories.map((c) => (
                  <Link
                    key={c.id}
                    href={`/search?category=${c.slug}`}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-body-m text-text-body hover:bg-bg-muted"
                  >
                    <span>{c.icon}</span>
                    {c.name}
                  </Link>
                ))}
              </div>
            </DrawerContent>
          </Drawer>

          {/* Logo */}
          <Link
            href="/"
            className="font-heading text-h5 font-bold tracking-tight text-text-primary lg:text-h4"
          >
            {t('common.brand')}
          </Link>

          {/* Search with category dropdown */}
          <form
            role="search"
            onSubmit={onSearch}
            className="hidden h-11 flex-1 items-center overflow-hidden rounded-md border border-border-default bg-bg-elevated focus-within:border-brand-solid md:flex"
          >
            <input
              type="search"
              name="q"
              aria-label={t('common.search')}
              placeholder={t('nav.search')}
              className="h-full min-w-0 flex-1 bg-transparent px-4 text-body-m text-text-body outline-none placeholder:text-text-placeholder"
            />
            <select
              name="category"
              aria-label={t('nav.categories')}
              defaultValue=""
              className="hidden h-full min-w-40 border-l border-border-subtle bg-transparent px-4 text-body-s text-text-muted outline-none lg:block"
            >
              <option value="">{t('common.viewAll')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              aria-label={t('common.search')}
              className="flex h-full items-center justify-center bg-slate-12 px-4 text-text-on-primary transition-colors hover:bg-slate-11"
            >
              <Search className="size-5" />
            </button>
          </form>

          {/* Actions */}
          <div className="ml-auto flex items-center gap-1 md:ml-0">
            <IconLink href="/search" label={t('common.search')} className="md:hidden">
              <Search className="size-5" />
            </IconLink>
            <IconLink href="/cart" label={t('nav.cart')}>
              <span className="relative">
                <ShoppingCart className="size-5" />
                {cartCount > 0 ? (
                  <span className="absolute -right-2 -top-2 inline-flex min-w-4 items-center justify-center rounded-full bg-danger-solid px-1 text-[10px] font-bold leading-4 text-text-on-primary">
                    {cartCount}
                  </span>
                ) : null}
              </span>
            </IconLink>
            {/* Wishlist page doesn't exist yet — disabled instead of a dead link. */}
            <button
              type="button"
              disabled
              aria-label={t('nav.wishlist')}
              className="hidden size-9 items-center justify-center rounded-md text-text-disabled sm:inline-flex"
            >
              <Heart className="size-5" />
            </button>
            <Link
              href="/sign-in"
              className="ml-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-text-body transition-colors hover:bg-bg-muted"
            >
              <User className="size-5" />
              <span className="hidden text-left lg:block">
                <span className="block text-[11px] leading-3 text-text-muted">
                  {t('auth.account')}
                </span>
                <span className="block text-body-s font-semibold text-text-primary">
                  {t('nav.account')}
                </span>
              </span>
            </Link>
          </div>
        </Container>
      </div>
    </header>
  );
}

function IconLink({
  href,
  label,
  children,
  className,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-md text-text-body transition-colors hover:bg-bg-muted hover:text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        className,
      )}
    >
      {children}
    </Link>
  );
}
