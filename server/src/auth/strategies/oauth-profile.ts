import { z } from 'zod';
import type { OAuthProvider } from '@repo/core';
import { type OAuthProfile, OAuthProfileSchema } from '../auth.schemas';

interface RawProfile {
  provider: OAuthProvider;
  providerUserId: string;
  email: string | undefined;
  emailVerified: boolean;
  name: string | undefined;
  avatarUrl: string | undefined;
}

const EmailSchema = z.email();
const UrlSchema = z.url();

/**
 * Normalizes a provider profile. A malformed email/avatar degrades to null instead of failing
 * the login; an email that is dropped can never count as verified.
 */
export function toOAuthProfile(raw: RawProfile): OAuthProfile {
  const email = EmailSchema.safeParse(raw.email);
  const avatar = UrlSchema.safeParse(raw.avatarUrl);
  return OAuthProfileSchema.parse({
    provider: raw.provider,
    providerUserId: raw.providerUserId,
    email: email.success ? email.data : null,
    emailVerified: email.success && raw.emailVerified,
    name: raw.name?.trim() || (email.success ? email.data.split('@')[0] : '') || '',
    avatarUrl: avatar.success ? avatar.data : null,
  });
}
