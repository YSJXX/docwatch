import { expect, test } from '@playwright/test';

const adrPreview = '/preview/docs/adr/adr-001';

test('cockpit loads', async ({ page }) => {
  await page.goto('/cockpit');

  await expect(page.locator('.rail')).toBeVisible();
  await expect(page.locator('#doc-frame')).toBeVisible();
  await expect(page.locator('#empty-state')).toBeVisible();
});

test('clicking a doc renders it in the preview iframe', async ({ page }) => {
  await page.goto('/cockpit');

  await page.locator(`[data-preview="${adrPreview}"]`).first().click();

  await expect(page.locator('#empty-state')).not.toBeVisible();
  await expect(page.locator('#doc-frame')).toHaveAttribute('src', new RegExp(adrPreview));
  await expect(page.frameLocator('#doc-frame').locator('h1, article').first()).toBeVisible();
});

test('malicious ?doc is ignored', async ({ page }) => {
  await page.goto('/cockpit?doc=https://example.com');

  await expect(page.locator('#empty-state')).toBeVisible();

  const frameSrc = await page.locator('#doc-frame').getAttribute('src');
  expect(frameSrc ?? '').not.toContain('example.com');
  expect(frameSrc ?? '').not.toContain('javascript:');
});
