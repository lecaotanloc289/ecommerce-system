'use client';

import * as React from 'react';
import { Link } from '@/i18n/navigation';
import { Send } from 'lucide-react';
import { Button } from '@repo/ui';
import { useT } from '../../i18n/use-locale';
import { CHAT_MAX_LENGTH, type LiveChatLine } from '../../lib/live-events';
import { cn } from '../../lib/utils';

const STICK_THRESHOLD_PX = 40;

/**
 * Message list. `overlay` floats over the video (mobile, pointer-events-none so the player
 * controls stay tappable); `panel` fills the desktop side column. role="log" implies polite
 * live announcements.
 */
export function LiveChatMessages({
  messages,
  variant,
  className,
}: {
  messages: LiveChatLine[];
  variant: 'overlay' | 'panel';
  className?: string;
}) {
  const t = useT();
  const listRef = React.useRef<HTMLUListElement>(null);
  const stickRef = React.useRef(true);
  const isOverlay = variant === 'overlay';

  const onScroll = () => {
    const el = listRef.current;
    if (el) {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
    }
  };

  React.useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <ul
      ref={listRef}
      role="log"
      aria-label={t('live.chatTitle')}
      onScroll={onScroll}
      className={cn(
        'flex flex-col gap-1.5 overflow-y-auto',
        isOverlay
          ? 'pointer-events-none max-h-44 px-3 pb-3 text-white [mask-image:linear-gradient(to_bottom,transparent,black_30%)]'
          : 'min-h-0 flex-1 p-4',
        className,
      )}
    >
      {messages.length === 0 ? (
        <li className={cn('text-body-s', isOverlay ? 'text-white/70' : 'text-text-muted')}>
          {t('live.chatEmpty')}
        </li>
      ) : (
        messages.map((m) => (
          <li
            key={m.id}
            className={cn(
              'break-words text-body-s',
              isOverlay
                ? 'w-fit max-w-[85%] rounded-lg bg-black/40 px-2 py-1 backdrop-blur-sm'
                : 'text-text-body',
            )}
          >
            <span
              className={cn(
                'mr-1.5 font-semibold',
                isOverlay ? 'text-white/80' : m.isOwn ? 'text-brand-text' : 'text-text-muted',
              )}
            >
              {m.displayName}
            </span>
            {m.text}
          </li>
        ))
      )}
    </ul>
  );
}

/** Composer (or the sign-in prompt) plus optional extra controls such as the heart button. */
export function LiveChatComposer({
  isSignedIn,
  onSend,
  actions,
  className,
}: {
  isSignedIn: boolean;
  onSend: (text: string) => void;
  actions?: React.ReactNode;
  className?: string;
}) {
  const t = useT();
  const [draft, setDraft] = React.useState('');

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onSend(draft);
    setDraft('');
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {isSignedIn ? (
        <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={CHAT_MAX_LENGTH}
            aria-label={t('live.chatPlaceholder')}
            placeholder={t('live.chatPlaceholder')}
            className="h-10 min-w-0 flex-1 rounded-full border border-border-default bg-bg-page px-4 text-body-s text-text-body outline-none placeholder:text-text-placeholder focus-visible:ring-2 focus-visible:ring-border-focus"
          />
          <Button
            type="submit"
            size="icon"
            aria-label={t('live.chatSend')}
            disabled={!draft.trim()}
            className="size-10 shrink-0 rounded-full"
          >
            <Send className="size-4" aria-hidden />
          </Button>
        </form>
      ) : (
        <Link
          href="/sign-in"
          className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-full border border-border-default px-4 text-body-s font-medium text-brand-text hover:bg-bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          {t('live.chatSignInPrompt')}
        </Link>
      )}
      {actions}
    </div>
  );
}
