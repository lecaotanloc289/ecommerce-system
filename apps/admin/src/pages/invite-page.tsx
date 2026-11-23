import { CenteredCard } from '@/components/centered-card';
import { useT } from '@/i18n/use-locale';

/**
 * `/invite?token=…` — staff invitation landing. Placeholder: T5.3 implements accepting
 * (`POST /v1/vendor-invitations/accept`), signing the invitee in first if needed.
 */
export function InvitePage() {
  const t = useT();
  return (
    <CenteredCard title={t('admin.invite.title')} description={t('admin.invite.description')} />
  );
}
