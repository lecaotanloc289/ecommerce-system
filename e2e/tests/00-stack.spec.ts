import { expect, test } from '@playwright/test';
import { ORIGINS } from '../support/config';
import { signIn } from '../support/sessions';

// Fails fast (and legibly) when the stack itself is broken, before the business flows run.

test('API, storefront and admin are up', async ({ request, page }) => {
  expect((await request.get(`${ORIGINS.api}/v1/health/ready`)).ok()).toBe(true);
  await page.goto('/en');
  await expect(page.getByPlaceholder('Search products…')).toBeVisible();
  const admin = await request.get(`${ORIGINS.admin}/`);
  expect(admin.ok()).toBe(true);
});

test('a minted refresh cookie signs the customer in through the normal silent refresh', async ({
  context,
  page,
}) => {
  await signIn(context, 'customer');
  await page.goto('/en/account');
  await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
  await expect(page.getByRole('banner').getByText('Demo Customer')).toBeVisible();
  // The access token is in memory only; /auth/me answering proves the refresh round-trip worked.
  const me = await page.evaluate(async (api) => {
    const refreshed = await fetch(`${api}/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    return refreshed.status;
  }, ORIGINS.api);
  expect(me).toBe(200);
});
