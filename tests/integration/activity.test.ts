import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getActivity } from '@/data/activity';
import { mergeConfig } from '@/data/config';

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-act-'));
  execSync('git init -q -b main && git config user.email t@e.com && git config user.name t', { cwd: root });
  await fs.mkdir(path.join(root, '.claude/plans'), { recursive: true });
  await fs.writeFile(path.join(root, 'README.md'), '# root');
  await fs.writeFile(path.join(root, '.claude/plans/active.md'), '# Active plan\n- [ ] task');
  execSync('git add . && git commit -q -m init', { cwd: root });
  await fs.writeFile(path.join(root, 'NOTES.md'), 'dirty');
});

it('dirty·recent·activePlan 반환', async () => {
  const act = await getActivity(root, mergeConfig({}));
  expect(act.dirty.some(d => d.path === 'NOTES.md')).toBe(true);
  expect(act.recentlyModified.length).toBeGreaterThan(0);
  expect(act.activePlan?.path).toContain('.claude/plans/active.md');
  expect(act.activePlan?.title).toBe('Active plan');
});
