import { expect, test } from '@playwright/test';
import { ACCOUNTS, ORIGINS } from '../support/config';
import { one, query } from '../support/db';
import { signIn } from '../support/sessions';
import { writeState } from '../support/state';
import { sendVnpayIpn } from '../support/vnpay';

// Flow b — the customer (cart already holds the Vendor A tee from flow a) adds a Vendor B mug,
// checks out the two-vendor cart, the gateway "pays" through the real signed VNPay IPN, and the
// order shows as paid in "My orders".

// Seed prices (VND): tee 199 000 (A), mug 89 000 (B); Standard shipping A 30 000, B 25 000.
const EXPECTED_TOTAL = 199_000 + 89_000 + 30_000 + 25_000;

test('customer checks out a 2-vendor cart and the payment webhook confirms it', async ({
  context,
  page,
}) => {
  await signIn(context, 'customer');

  await page.goto('/en/product/white-ceramic-mug');
  await expect(page.getByRole('heading', { level: 1, name: 'White Ceramic Mug' })).toBeVisible();
  await page.getByRole('button', { name: 'Add to cart' }).click();

  await page.goto('/en/cart');
  await expect(page.getByRole('link', { name: 'Basic Tee' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'White Ceramic Mug' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Proceed to checkout' }).click();

  // Step 1 — address (the seeded default is preselected).
  await expect(page.getByRole('radio', { name: /Demo Customer/ })).toBeChecked();
  await page.getByRole('link', { name: 'Continue' }).click();

  // Step 2 — one shipping method per vendor, and the payment provider.
  const groups = page.getByRole('radiogroup', { name: /Shipping from/ });
  await expect(groups).toHaveCount(2);
  for (const group of await groups.all()) {
    await group.getByRole('radio', { name: /Standard/ }).check();
  }
  await page.getByRole('radio', { name: /VNPay/ }).check();
  await page.getByRole('link', { name: 'Continue' }).click();

  // Step 3 — review and place the order; the worker opens the (fake) VNPay session.
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.waitForURL((url) => url.origin === ORIGINS.gateway, { timeout: 90_000 });
  const gatewayUrl = new URL(page.url());
  const paymentId = gatewayUrl.searchParams.get('vnp_TxnRef');
  expect(paymentId).toBeTruthy();
  expect(gatewayUrl.searchParams.get('vnp_Amount')).toBe(String(EXPECTED_TOTAL * 100));

  const payment = await one<{ order_id: string; status: string }>(
    'SELECT order_id, status FROM payments WHERE id = $1',
    [paymentId],
  );
  expect(payment.status).toBe('PENDING');
  const orderId = payment.order_id;

  // The gateway reports success: signed IPN straight to the production webhook route.
  const ack = await sendVnpayIpn({ paymentId: paymentId ?? '', amountVnd: EXPECTED_TOTAL });
  expect(ack.RspCode).toBe('00');

  const subOrders = await query<{ id: string; vendor: string; status: string }>(
    `SELECT s.id, v.slug AS vendor, s.status
       FROM sub_orders s JOIN vendors v ON v.id = s.vendor_id
      WHERE s.order_id = $1 ORDER BY v.slug`,
    [orderId],
  );
  expect(subOrders.map((s) => [s.vendor, s.status])).toEqual([
    ['vendor-a', 'PAID'],
    ['vendor-b', 'PAID'],
  ]);
  const order = await one<{ status: string; grand_total_amount: string; customer: string }>(
    `SELECT o.status, o.grand_total_amount::text, u.email AS customer
       FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.id = $1`,
    [orderId],
  );
  expect(order).toMatchObject({
    status: 'PAID',
    grand_total_amount: String(EXPECTED_TOTAL),
    customer: ACCOUNTS.customer,
  });

  // What the customer sees in "My orders".
  await page.goto('/en/account/orders');
  await expect(page.getByText('Paid').first()).toBeVisible();
  await page.goto(`/en/account/orders/${orderId}`);
  await expect(page.getByText('Paid').first()).toBeVisible();

  writeState({
    orderId,
    paymentId: paymentId ?? '',
    grandTotal: EXPECTED_TOTAL,
    subOrders: {
      vendorA: subOrders.find((s) => s.vendor === 'vendor-a')?.id ?? '',
      vendorB: subOrders.find((s) => s.vendor === 'vendor-b')?.id ?? '',
    },
  });
});
