import { expect, test } from '@playwright/test';
import { ACCOUNTS } from '../support/config';
import { query } from '../support/db';
import { signIn } from '../support/sessions';

// Flow a — a guest browses home → category → product, adds to the cart, signs in, and the
// guest cart is merged into the server cart.

test('guest browses, adds to cart, signs in and the cart is merged', async ({ context, page }) => {
  await page.goto('/en');
  await page
    .getByRole('link', { name: /apparel/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/en\/categories\//);

  await page.getByRole('link', { name: 'Basic Tee' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Basic Tee' })).toBeVisible();
  await page.getByRole('button', { name: 'Add to cart' }).click();

  await page.goto('/en/cart');
  await expect(page.getByRole('link', { name: 'Basic Tee' }).first()).toBeVisible();
  // Still anonymous: the cart lives in this browser only.
  await expect(page.getByRole('link', { name: 'Sign in to check out' })).toBeVisible();

  // "Sign in": the session cookie the OAuth callback would have set; the app's silent refresh
  // does the rest and merges the guest lines once.
  await signIn(context, 'customer');
  await page.reload();
  await expect(page.getByRole('link', { name: 'Proceed to checkout' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Basic Tee' }).first()).toBeVisible();

  await expect
    .poll(async () => {
      const rows = await query<{ quantity: number; sku: string }>(
        `SELECT ci.quantity, v.sku
           FROM cart_items ci
           JOIN carts c ON c.id = ci.cart_id
           JOIN users u ON u.id = c.user_id
           JOIN product_variants v ON v.id = ci.variant_id
          WHERE u.email = $1`,
        [ACCOUNTS.customer],
      );
      return rows.map((r) => `${r.sku}x${r.quantity}`);
    })
    .toEqual(['TEE-BLK-Mx1']);

  // The guest cart was emptied once merged (no lines left in localStorage).
  const guestCart = await page.evaluate(() => localStorage.getItem('guest-cart.v2'));
  const guestLineCount =
    guestCart === null ? 0 : (JSON.parse(guestCart) as { lines?: unknown[] }).lines?.length;
  expect(guestLineCount).toBe(0);
});
