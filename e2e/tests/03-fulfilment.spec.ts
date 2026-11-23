import { type BrowserContext, expect, type Page, test } from '@playwright/test';
import { ORIGINS, type AccountKey } from '../support/config';
import { one } from '../support/db';
import { signIn } from '../support/sessions';
import { requireState } from '../support/state';

// Flow c — each vendor owner accepts → ships → delivers their sub-order in the admin vendor
// portal; then the customer confirms receipt of one of them on the storefront.

async function useEnglishAdmin(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('admin.locale', 'en');
    } catch {
      // storage unavailable: the admin falls back to its default locale
    }
  });
}

async function fulfil(
  context: BrowserContext,
  page: Page,
  account: AccountKey,
  subOrderId: string,
  tracking: string,
): Promise<void> {
  await signIn(context, account);
  await page.goto(`${ORIGINS.admin}/vendor/orders/${subOrderId}`);

  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByRole('button', { name: 'Ship', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Ship', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Carrier').fill('E2E Express');
  await dialog.getByLabel('Tracking number').fill(tracking);
  await dialog.getByRole('button', { name: 'Mark as shipped' }).click();
  await expect(page.getByRole('button', { name: 'Mark delivered' })).toBeVisible();

  await page.getByRole('button', { name: 'Mark delivered' }).click();
  await expect(page.getByRole('button', { name: 'Mark delivered' })).toBeHidden();
  await expect
    .poll(
      async () =>
        (await one<{ status: string }>('SELECT status FROM sub_orders WHERE id = $1', [subOrderId]))
          .status,
    )
    .toBe('DELIVERED');
}

test('vendors fulfil their sub-orders in the admin portal', async ({ browser }) => {
  for (const [account, id, tracking] of [
    ['vendorA', requireState('subOrders').vendorA, 'E2E-TRACK-A'],
    ['vendorB', requireState('subOrders').vendorB, 'E2E-TRACK-B'],
  ] as const) {
    // A fresh browser context per vendor: each has its own session cookie.
    const context = await browser.newContext({ locale: 'en-US' });
    await useEnglishAdmin(context);
    const page = await context.newPage();
    try {
      await fulfil(context, page, account, id ?? '', tracking);
    } finally {
      await context.close();
    }
  }
});

test('the customer confirms receipt of a delivered shipment', async ({ context, page }) => {
  const orderId = requireState('orderId');
  await signIn(context, 'customer');
  await page.goto(`/en/account/orders/${orderId}`);

  const confirm = page.getByRole('button', { name: 'I received this' });
  await expect(confirm).toHaveCount(2);
  await confirm.first().click();
  await expect(page.getByText('Marked as received.')).toBeVisible();

  const { count } = await one<{ count: string }>(
    `SELECT count(*)::text FROM sub_orders WHERE order_id = $1 AND status = 'COMPLETED' AND completed_at IS NOT NULL`,
    [orderId],
  );
  expect(count).toBe('1');
});
