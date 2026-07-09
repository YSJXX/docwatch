import { expect, test } from '@playwright/test';

const planPreview = '/preview/docs/adr/adr-001';
const readmePreview = '/preview/readme';

test('monitor loads', async ({ page }) => {
  await page.goto('/monitor');

  await expect(page.locator('.monitor-col')).toHaveCount(3);
  expect(await page.locator('.stat-chip').count()).toBeGreaterThanOrEqual(3);
  await expect(page.locator('#doc-frame')).toBeAttached();
  await expect(page.locator('#detail-pane .empty-state')).toBeVisible();
  await expect(page.locator('#col3-empty')).toBeVisible();
});

test('selecting a plan doc shows the plan tracker', async ({ page }) => {
  await page.goto('/monitor');

  await page.locator(`.tree-row.file[data-preview="${planPreview}"]`).click();

  await expect(page.locator('#plan-pane')).toBeVisible();
  expect(await page.locator('#plan-pane .plan-row').count()).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#col3-empty')).not.toBeVisible();
  await expect(page.locator('#doc-frame')).not.toBeVisible();
  await expect(page.locator('#detail-pane .detail-name')).toBeVisible();
});

test('selecting a non-plan doc shows the iframe preview', async ({ page }) => {
  await page.goto('/monitor');

  await page.locator(`.tree-row.file[data-preview="${readmePreview}"]`).click();

  await expect(page.locator('#doc-frame')).toHaveAttribute('src', new RegExp(readmePreview));
  await expect(page.locator('#doc-frame')).toBeVisible();
  await expect(page.locator('#plan-pane')).not.toBeVisible();
  await expect(page.frameLocator('#doc-frame').locator('article, h1').first()).toBeVisible();
});

test('theme toggle persists across reload', async ({ page }) => {
  await page.goto('/monitor');

  await page.locator('[data-theme-set="light"]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-theme', 'light');
  await page.locator('[data-theme-set="dark"]').click();
});

test('malicious ?doc is ignored', async ({ page }) => {
  await page.goto('/monitor?doc=https://example.com');

  await expect(page.locator('#col3-empty')).toBeVisible();

  const frameSrc = await page.locator('#doc-frame').getAttribute('src');
  expect(frameSrc ?? '').not.toContain('example.com');
  expect(frameSrc ?? '').not.toContain('javascript:');
});
