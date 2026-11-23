import type { Money, OrderCancelReason } from '@repo/core';
import {
  createTranslator,
  formatDateTime,
  formatMoney,
  type AppLocale,
  type TFunction,
} from '@repo/i18n';
import type { EmailContent } from './mailer';

// Pure renderers: data in, { subject, text, html } out. Every word comes from `@repo/i18n`
// (`email.*`), money/dates from its formatters, in the recipient's locale (Golden Rule #7).

interface Action {
  label: string;
  url: string;
}

interface LayoutInput {
  t: TFunction;
  /** Recipient name; null when the recipient has no account yet (invitations). */
  name: string | null;
  subject: string;
  paragraphs: string[];
  action?: Action;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Greeting, paragraphs, optional link, signature, footer — as plain text and simple HTML. */
function layout({ t, name, subject, paragraphs, action }: LayoutInput): EmailContent {
  const greeting = name === null ? t('email.greetingNoName') : t('email.greeting', { name });
  const signature = t('email.signature');
  const footer = t('email.footer');

  const text = [
    greeting,
    ...paragraphs,
    ...(action ? [`${action.label}: ${action.url}`] : []),
    signature,
    footer,
  ].join('\n\n');

  // Inline styles with literal colours on purpose: email clients ignore stylesheets and CSS
  // variables, so the design tokens cannot apply here.
  const p = (s: string, style = ''): string =>
    `<p style="margin:0 0 16px${style}">${escapeHtml(s)}</p>`;
  const html = [
    '<!doctype html>',
    `<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>`,
    '<body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">',
    p(greeting),
    ...paragraphs.map((s) => p(s)),
    ...(action
      ? [
          `<p style="margin:0 0 16px"><a href="${escapeHtml(action.url)}" style="color:#2563eb">${escapeHtml(action.label)}</a></p>`,
        ]
      : []),
    p(signature),
    p(footer, ';color:#6b7280;font-size:12px'),
    '</body></html>',
  ].join('\n');

  return { subject, text, html };
}

/** Storefront order page for the email link. */
export function orderUrl(webOrigin: string, locale: AppLocale, orderId: string): string {
  const url = new URL(`/${locale}/order/track`, webOrigin);
  url.searchParams.set('orderId', orderId);
  return url.toString();
}

interface Recipient {
  locale: AppLocale;
  name: string;
}

export function renderOrderCreated(
  input: Recipient & { orderId: string; total: Money; paymentDeadlineAt: Date | null; url: string },
): EmailContent {
  const t = createTranslator(input.locale);
  return layout({
    t,
    name: input.name,
    subject: t('email.orderCreated.subject', { orderId: input.orderId }),
    paragraphs: [
      t('email.orderCreated.intro'),
      t('email.orderCreated.total', { total: formatMoney(input.total, input.locale) }),
      ...(input.paymentDeadlineAt
        ? [
            t('email.orderCreated.deadline', {
              deadline: formatDateTime(input.paymentDeadlineAt.toISOString(), input.locale),
            }),
          ]
        : []),
    ],
    action: { label: t('email.viewOrder'), url: input.url },
  });
}

export function renderOrderPaid(
  input: Recipient & { orderId: string; total: Money; url: string },
): EmailContent {
  const t = createTranslator(input.locale);
  return layout({
    t,
    name: input.name,
    subject: t('email.orderPaid.subject', { orderId: input.orderId }),
    paragraphs: [t('email.orderPaid.intro', { total: formatMoney(input.total, input.locale) })],
    action: { label: t('email.viewOrder'), url: input.url },
  });
}

export function renderOrderCancelled(
  input: Recipient & { orderId: string; reason: OrderCancelReason; url: string },
): EmailContent {
  const t = createTranslator(input.locale);
  return layout({
    t,
    name: input.name,
    subject: t('email.orderCancelled.subject', { orderId: input.orderId }),
    paragraphs: [
      input.reason === 'CUSTOMER'
        ? t('email.orderCancelled.byCustomer')
        : t('email.orderCancelled.paymentExpired'),
    ],
    action: { label: t('email.viewOrder'), url: input.url },
  });
}

export function renderSubOrderShipped(
  input: Recipient & {
    orderId: string;
    vendorName: string;
    carrier: string | null;
    trackingNumber: string | null;
    url: string;
  },
): EmailContent {
  const t = createTranslator(input.locale);
  return layout({
    t,
    name: input.name,
    subject: t('email.subOrderShipped.subject', { orderId: input.orderId }),
    paragraphs: [
      t('email.subOrderShipped.intro', { vendor: input.vendorName }),
      ...(input.carrier && input.trackingNumber
        ? [
            t('email.subOrderShipped.tracking', {
              carrier: input.carrier,
              trackingNumber: input.trackingNumber,
            }),
          ]
        : []),
    ],
    action: { label: t('email.viewOrder'), url: input.url },
  });
}

export function renderVendorApplicationApproved(
  input: Recipient & { portalUrl: string },
): EmailContent {
  const t = createTranslator(input.locale);
  return layout({
    t,
    name: input.name,
    subject: t('email.vendorApplicationApproved.subject'),
    paragraphs: [t('email.vendorApplicationApproved.intro')],
    action: { label: t('email.vendorApplicationApproved.portal'), url: input.portalUrl },
  });
}

export function renderVendorApplicationRejected(
  input: Recipient & { reason: string | null },
): EmailContent {
  const t = createTranslator(input.locale);
  return layout({
    t,
    name: input.name,
    subject: t('email.vendorApplicationRejected.subject'),
    paragraphs: [
      t('email.vendorApplicationRejected.intro'),
      ...(input.reason
        ? [t('email.vendorApplicationRejected.reason', { reason: input.reason })]
        : []),
    ],
  });
}

export function renderPayoutReleased(
  input: Recipient & { orderId: string; vendorName: string; amount: Money; portalUrl: string },
): EmailContent {
  const t = createTranslator(input.locale);
  return layout({
    t,
    name: input.name,
    subject: t('email.payoutReleased.subject', { orderId: input.orderId }),
    paragraphs: [
      t('email.payoutReleased.intro', {
        amount: formatMoney(input.amount, input.locale),
        orderId: input.orderId,
        vendor: input.vendorName,
      }),
    ],
    action: { label: t('email.vendorApplicationApproved.portal'), url: input.portalUrl },
  });
}

/** Staff invitation; `acceptUrl` carries the raw token — never log the rendered email. */
export function renderVendorInvitation(input: {
  locale: AppLocale;
  name: string | null;
  vendorName: string;
  expiresAt: Date;
  acceptUrl: string;
}): EmailContent {
  const t = createTranslator(input.locale);
  return layout({
    t,
    name: input.name,
    subject: t('email.vendorInvitation.subject', { vendor: input.vendorName }),
    paragraphs: [
      t('email.vendorInvitation.intro', { vendor: input.vendorName }),
      t('email.vendorInvitation.howTo', {
        expiresAt: formatDateTime(input.expiresAt.toISOString(), input.locale),
      }),
    ],
    action: { label: t('email.vendorInvitation.accept'), url: input.acceptUrl },
  });
}
