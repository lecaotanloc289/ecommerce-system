import { expect, test } from '@playwright/test';
import { ACCOUNTS, ORIGINS } from '../support/config';
import { one } from '../support/db';
import { signIn } from '../support/sessions';

// Flow e — the platform admin approves a pending vendor application (seeded by
// scripts/seed-extra.ts, as if the applicant had submitted /sell with uploaded KYC documents).
// The shop is created ACTIVE with a zero wallet and the applicant becomes its owner.

test('admin approves a vendor application', async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem('admin.locale', 'en'));
  await signIn(context, 'admin');
  await page.goto(`${ORIGINS.admin}/platform/applications`);

  const row = page.getByRole('row', { name: /Applicant Demo/ });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Review' }).click();

  const detail = page.getByRole('dialog', { name: 'Seller application' });
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'Approve' }).click();

  const approve = page.getByRole('dialog', { name: 'Approve application' });
  await approve.getByLabel('Shop name').fill('Applicant Shop');
  await approve.getByLabel('Shop URL slug').fill('applicant-shop');
  await approve.getByRole('button', { name: 'Approve' }).click();

  await expect(approve).toBeHidden();
  await expect
    .poll(async () => {
      const app = await one<{ status: string }>(
        `SELECT a.status FROM vendor_applications a JOIN users u ON u.id = a.applicant_id WHERE u.email = $1`,
        [ACCOUNTS.applicant],
      );
      return app.status;
    })
    .toBe('APPROVED');

  const vendor = await one<{ status: string; balance: string; owner: string }>(
    `SELECT v.status, w.balance_amount::text AS balance, u.email AS owner
       FROM vendors v JOIN wallets w ON w.vendor_id = v.id JOIN users u ON u.id = v.owner_id
      WHERE v.slug = 'applicant-shop'`,
  );
  expect(vendor).toEqual({ status: 'ACTIVE', balance: '0', owner: ACCOUNTS.applicant });

  const role = await one<{ role: string }>(
    `SELECT r.role FROM user_roles r JOIN users u ON u.id = r.user_id
      WHERE u.email = $1 AND r.role = 'VENDOR_OWNER'`,
    [ACCOUNTS.applicant],
  );
  expect(role.role).toBe('VENDOR_OWNER');
});
