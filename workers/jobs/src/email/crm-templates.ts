import { createTranslator, type AppLocale } from '@repo/i18n';
import type { EmailContent } from './mailer';
import { escapeHtml } from './templates';

// CRM email (vendor CRM, decisions C6/C7/C12): the shop-authored plain text, already rendered by
// `renderCrmTemplate`, plus platform-made actions and the unsubscribe footer. Every platform word
// comes from `@repo/i18n` `crm.email.*`; every interpolated value is HTML-escaped (the shop text
// is plain text and never trusted as HTML). No tracking pixel.

export interface CrmEmailAction {
  label: string;
  url: string;
}

export interface CrmEmailInput {
  locale: AppLocale;
  /** Subject = the notification title (`crm.notificationTitle.*`). */
  subject: string;
  /** Rendered message text; line breaks become paragraphs. */
  body: string;
  shopName: string;
  /** Code of a valid attached coupon, shown as its own line (null = no coupon). */
  couponCode: string | null;
  actions: CrmEmailAction[];
  /** Storefront unsubscribe page links; `marketing` only on marketing mail. */
  unsubscribe: { marketing: string | null; all: string };
}

export function renderCrmEmail(input: CrmEmailInput): EmailContent {
  const t = createTranslator(input.locale);
  const paragraphs = input.body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const couponLine =
    input.couponCode === null ? null : `${t('crm.email.useCoupon')}: ${input.couponCode}`;
  const footer = t('crm.email.footerReason', { shopName: input.shopName });
  const unsubscribeLinks: CrmEmailAction[] = [
    ...(input.unsubscribe.marketing === null
      ? []
      : [{ label: t('crm.email.unsubscribeMarketing'), url: input.unsubscribe.marketing }]),
    { label: t('crm.email.unsubscribeAll'), url: input.unsubscribe.all },
  ];

  const text = [
    ...paragraphs,
    ...(couponLine === null ? [] : [couponLine]),
    ...input.actions.map((a) => `${a.label}: ${a.url}`),
    footer,
    ...unsubscribeLinks.map((a) => `${a.label}: ${a.url}`),
  ].join('\n\n');

  // Inline styles with literal colours on purpose (email clients ignore stylesheets).
  const p = (s: string, style = ''): string =>
    `<p style="margin:0 0 16px${style}">${escapeHtml(s)}</p>`;
  const link = (a: CrmEmailAction, style: string): string =>
    `<a href="${escapeHtml(a.url)}" style="${style}">${escapeHtml(a.label)}</a>`;
  const html = [
    '<!doctype html>',
    `<html><head><meta charset="utf-8"><title>${escapeHtml(input.subject)}</title></head>`,
    '<body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">',
    ...paragraphs.map((s) => p(s)),
    ...(couponLine === null ? [] : [p(couponLine, ';font-weight:bold')]),
    ...input.actions.map((a) => `<p style="margin:0 0 16px">${link(a, 'color:#2563eb')}</p>`),
    p(footer, ';color:#6b7280;font-size:12px'),
    `<p style="margin:0;color:#6b7280;font-size:12px">${unsubscribeLinks
      .map((a) => link(a, 'color:#6b7280'))
      .join(' · ')}</p>`,
    '</body></html>',
  ].join('\n');

  return { subject: input.subject, text, html };
}
