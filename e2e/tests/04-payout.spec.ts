import { expect, test } from '@playwright/test';
import { subOrderNet } from '@repo/core';
import { ORIGINS } from '../support/config';
import { one, query } from '../support/db';
import { runJob } from '../support/jobs';
import { signIn } from '../support/sessions';
import { requireState } from '../support/state';

// Flow d — payouts. There is no fake clock: time is moved by back-dating timestamps and lowering
// the hold period, then the real `release-payouts` job runs once. Each vendor wallet must grow by
// exactly the net of its sub-order:  net = subtotal + shipping − vendorDiscount − commission.

// Independent arithmetic from the seed prices, at the seed commission of 10 % of the subtotal.
const COMMISSION_BPS = 1_000;
const NET = {
  vendorA: 199_000 + 30_000 - (199_000 * COMMISSION_BPS) / 10_000, // 209 100
  vendorB: 89_000 + 25_000 - (89_000 * COMMISSION_BPS) / 10_000, // 105 100
} as const;

test('released payouts credit each vendor wallet with the exact net', async ({ browser }) => {
  const { vendorA, vendorB } = requireState('subOrders');
  const orderId = requireState('orderId');

  const settings = await one<{ commission_bps: number }>(
    'SELECT commission_bps FROM platform_settings',
  );
  expect(settings.commission_bps, 'seed commission changed — update NET above').toBe(
    COMMISSION_BPS,
  );

  // Drive time: the customer confirmed one sub-order (flow c); the other has been DELIVERED for
  // longer than the refund window, so auto-complete finishes it.
  await query(
    `UPDATE sub_orders SET delivered_at = (now() AT TIME ZONE 'UTC') - interval '8 days'
      WHERE order_id = $1 AND status = 'DELIVERED'`,
    [orderId],
  );
  runJob('auto-complete-sub-orders');
  const statuses = await query<{ status: string }>(
    'SELECT status FROM sub_orders WHERE order_id = $1',
    [orderId],
  );
  expect(statuses.map((s) => s.status)).toEqual(['COMPLETED', 'COMPLETED']);

  // Hold period 0 → every completed sub-order is due; back-date completion anyway for clarity.
  await query('UPDATE platform_settings SET hold_period_days = 0');
  await query(
    `UPDATE sub_orders SET completed_at = (now() AT TIME ZONE 'UTC') - interval '1 hour' WHERE order_id = $1`,
    [orderId],
  );
  runJob('release-payouts');

  // Ground truth in the database: wallets and the books.
  const wallets = await query<{ slug: string; balance: string }>(
    `SELECT v.slug, w.balance_amount::text AS balance
       FROM wallets w JOIN vendors v ON v.id = w.vendor_id ORDER BY v.slug`,
  );
  expect(wallets).toEqual([
    { slug: 'vendor-a', balance: String(NET.vendorA) },
    { slug: 'vendor-b', balance: String(NET.vendorB) },
  ]);
  // The system's own commission figures agree with the pure pricing function of @repo/core.
  const rows = await query<{ id: string; subtotal: string; shipping: string; commission: string }>(
    `SELECT id, subtotal_amount::text AS subtotal, shipping_amount::text AS shipping,
            commission_amount::text AS commission
       FROM sub_orders WHERE order_id = $1 ORDER BY id`,
    [orderId],
  );
  const zero = { amount: 0, currency: 'VND' } as const;
  const money = (value: string) => ({ amount: Number(value), currency: 'VND' }) as const;
  const nets = rows.map(
    (r) =>
      subOrderNet({
        subtotal: money(r.subtotal),
        shipping: money(r.shipping),
        vendorDiscount: zero,
        platformDiscount: zero,
        commission: money(r.commission),
      }).amount,
  );
  expect(nets.sort()).toEqual([NET.vendorA, NET.vendorB].sort());
  expect(vendorA).toBeTruthy();
  expect(vendorB).toBeTruthy();
  const { sum } = await one<{ sum: string }>(
    `SELECT coalesce(sum(amount), 0)::text AS sum FROM ledger_entries WHERE entry_type = 'PAYOUT_OUT'`,
  );
  expect(sum).toBe('0');

  // What each vendor owner sees in the portal.
  for (const [account, net] of [
    ['vendorA', NET.vendorA],
    ['vendorB', NET.vendorB],
  ] as const) {
    const context = await browser.newContext({ locale: 'en-US' });
    await context.addInitScript(() => localStorage.setItem('admin.locale', 'en'));
    await signIn(context, account);
    const page = await context.newPage();
    try {
      await page.goto(`${ORIGINS.admin}/vendor/wallet`);
      await expect(page.getByText(net.toLocaleString('en-US')).first()).toBeVisible();
      await expect(page.getByText('Nothing pending.')).toBeVisible();
    } finally {
      await context.close();
    }
  }
});
