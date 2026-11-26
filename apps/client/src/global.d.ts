import type { routing } from './i18n/routing';

// Types next-intl's locale APIs (`useLocale`, `hasLocale`, `Link`'s `locale` prop) as `AppLocale`.
declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
  }
}
