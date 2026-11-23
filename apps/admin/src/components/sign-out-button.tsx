import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button, toast, type ButtonProps } from '@repo/ui';
import { authStore } from '@/auth/session';
import { useT } from '@/i18n/use-locale';

/**
 * Revokes the session. On success no navigation is needed: the store turns `anonymous`,
 * `RequireAuth` sends the user to `/login`, and `App` clears the query cache. If the revoke fails
 * the user stays signed in and is told so (the cookie would sign them back in on reload).
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
        void authStore
          .getState()
          .signOut()
          .then((signedOut) => {
            if (signedOut) return;
            setPending(false);
            toast.error(t('admin.user.signOutFailed'));
          });
      }}
    >
      {t('admin.user.signOut')}
    </Button>
  );
}
