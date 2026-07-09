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

test('selecting a doc with checkboxes still shows the full document', async ({ page }) => {
  await page.goto('/monitor');

  await page.locator(`.tree-row.file[data-preview="${planPreview}"]`).click();

  // The preview always renders the whole document — never a tracker in its place.
  await expect(page.locator('#doc-frame')).toHaveAttribute('src', new RegExp(planPreview));
  await expect(page.locator('#doc-frame')).toBeVisible();
  await expect(page.locator('#col3-empty')).not.toBeVisible();
  await expect(page.locator('#detail-pane .detail-name')).toBeVisible();
});

test('project checklist section lists items and opens the source doc', async ({ page }) => {
  await page.goto('/monitor');

  await expect(page.locator('#checklist-list .cl-item').first()).toBeVisible();

  await page.locator(`.cl-doc[data-preview="${planPreview}"]`).first().click();

  await expect(page.locator('#doc-frame')).toHaveAttribute('src', new RegExp(planPreview));
  await expect(page.locator('#doc-frame')).toBeVisible();
});

test('selecting a non-plan doc shows the iframe preview', async ({ page }) => {
  await page.goto('/monitor');

  await page.locator(`.tree-row.file[data-preview="${readmePreview}"]`).click();

  await expect(page.locator('#doc-frame')).toHaveAttribute('src', new RegExp(readmePreview));
  await expect(page.locator('#doc-frame')).toBeVisible();
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

test('watched config files appear in the tree and open the code preview', async ({ page }) => {
  await page.goto('/monitor');

  const cfg = page.locator('.tree-row.file[data-preview="/rawpreview/package.json"]');
  await expect(cfg).toBeVisible();
  await cfg.click();

  await expect(page.locator('#doc-frame')).toHaveAttribute('src', /\/rawpreview\/package\.json/);
  await expect(page.locator('#doc-frame')).toBeVisible();
  await expect(page.frameLocator('#doc-frame').locator('pre').first()).toBeVisible();
});

test('rawpreview path traversal via ?doc is ignored', async ({ page }) => {
  await page.goto('/monitor?doc=' + encodeURIComponent('/rawpreview/../../etc/passwd'));

  await expect(page.locator('#col3-empty')).toBeVisible();
  const frameSrc = await page.locator('#doc-frame').getAttribute('src');
  expect(frameSrc ?? '').not.toContain('etc/passwd');
});

test('code TODO section lists comment markers from source files', async ({ page }) => {
  await page.goto('/monitor');

  const todoList = page.locator('#todo-list');
  await expect(todoList.locator('.todo-file', { hasText: 'src/app.ts' })).toBeVisible();
  await expect(todoList.locator('.todo-tag.todo').first()).toBeVisible();
  await expect(todoList.locator('.todo-tag.fixme').first()).toBeVisible();
  await expect(todoList.locator('.todo-tag.hack').first()).toBeVisible();
  // the "TODO not a real marker" string literal must be excluded
  expect(await todoList.locator('.todo-item', { hasText: 'not a real marker' }).count()).toBe(0);
});
