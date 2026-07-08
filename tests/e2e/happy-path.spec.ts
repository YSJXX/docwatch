import { expect, test } from '@playwright/test';

test('dashboard renders three sections', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('#live-activity')).toBeVisible();
  await expect(page.locator('#timeline')).toBeVisible();
  await expect(page.locator('#cards')).toBeVisible();
});

test('root redirects to /cockpit', async ({ page }) => {
  await page.goto('/');
  expect(page.url()).toContain('/cockpit');
});

test('hostile frontmatter document renders', async ({ page }) => {
  const response = await page.goto('/docs/hostile');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Hostile' }).first()).toBeVisible();
});
