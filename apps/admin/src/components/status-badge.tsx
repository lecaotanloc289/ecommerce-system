import type { ReactNode } from 'react';
import { Badge } from '@repo/ui';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** Coloured pill for a status label; the caller maps its enum to a tone and a translated label. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <Badge variant={tone}>{children}</Badge>;
}
