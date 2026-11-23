import { ChevronDown } from 'lucide-react';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@repo/ui';
import { ROLE_LABEL_KEYS } from '@/auth/roles';
import { useCurrentUser } from '@/auth/session';
import { useT } from '@/i18n/use-locale';
import { SignOutButton } from '../sign-out-button';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((p) => p?.charAt(0).toUpperCase() ?? '').join('') || '?';
}

export function UserMenu() {
  const t = useT();
  const user = useCurrentUser();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('admin.user.menu')}
          className="gap-2 px-1.5"
        >
          <Avatar size="xs">
            {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-caption">{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate text-text-primary sm:inline">{user.name}</span>
          <ChevronDown className="size-4 text-text-muted" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-64 flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="truncate text-body-s font-semibold text-text-primary">{user.name}</span>
          {user.email ? (
            <span className="truncate text-caption text-text-muted">{user.email}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {user.roles.map((role) => (
            <Badge key={role} variant={role === 'CUSTOMER' ? 'neutral' : 'brand'}>
              {t(ROLE_LABEL_KEYS[role])}
            </Badge>
          ))}
        </div>
        <SignOutButton fullWidth />
      </PopoverContent>
    </Popover>
  );
}
