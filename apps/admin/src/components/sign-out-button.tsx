import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button, type ButtonProps } from '@repo/ui';
import { authStore } from '@/auth/session';
import { useT } from '@/i18n/use-locale';

/**
 * Revokes the session. No navigation needed: the store turns `anonymous`, `RequireAuth` sends
 * the user to `/login`, and `App` clears the query cache.
 */
export function SignOutButton(props: Pick<ButtonProps, 'variant' | 'fullWidth' | 'className'>) {
  const t = useT();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      {...props}
      loading={pending}
      iconLeft={<LogOut aria-hidden />}
      onClick={() => {
        setPending(true);
        void authStore.getState().signOut();
      }}
    >
      {t('admin.user.signOut')}
    </Button>
  );
}
