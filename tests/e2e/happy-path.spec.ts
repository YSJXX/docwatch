import { expect, test } from '@playwright/test';

test('dashboard renders three sections', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('#live-activity')).toBeVisible();
  await expect(page.locator('#timeline')).toBeVisible();
  await expect(page.locator('#cards')).toBeVisible();
});

test('root redirects to /dashboard', async ({ page }) => {
  await page.goto('/');
  expect(page.url()).toContain('/dashboard');
});
