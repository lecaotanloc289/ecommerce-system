import { useEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from '@repo/ui';
import { authStore } from '@/auth/session';
import { useLocale } from '@/i18n/use-locale';
import { createQueryClient } from '@/lib/query-client';
import { appRoutes } from '@/router/routes';

const router = createBrowserRouter(appRoutes);

export function App() {
  const [queryClient] = useState(createQueryClient);
  const { locale, t } = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t('admin.appName');
  }, [locale, t]);

  // A session that ends (sign-out, rejected refresh) must not leave the previous user's data cached.
  useEffect(
    () =>
      authStore.subscribe((state, prev) => {
        if (state.status === 'anonymous' && prev.status !== 'anonymous') queryClient.clear();
      }),
    [queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}
