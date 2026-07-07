import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const target = process.env.DOCWATCH_E2E_TARGET ?? path.resolve('.spike/target');
const adr = path.join(target, 'docs/adr/ADR-001.md');

test('external file edit updates activity', async ({ request }) => {
  const before = await (await request.get('/api/activity.json')).json();
  await fs.appendFile(adr, '\n- [ ] e2e probe\n');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const after = await (await request.get('/api/activity.json')).json();

  expect(after.generatedAt).toBeGreaterThan(before.generatedAt);
  expect(after.recentlyModified.some((x: any) => x.path === 'docs/adr/ADR-001.md')).toBe(true);
});
