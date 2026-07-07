import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { scanGitLog, scanDirtyFiles } from '@/data/scan';

const FIXTURE = path.resolve(__dirname, '../fixtures/sample-repo');
beforeAll(() => {
  execSync(`bash ${path.resolve(__dirname, '../fixtures/setup-sample-repo.sh')} ${FIXTURE}`, { stdio: 'inherit' });
});

it('역시간순 커밋 + 파일 목록', async () => {
  const commits = await scanGitLog(FIXTURE, 10);
  expect(commits.length).toBe(3);
  expect(commits[0].subject).toContain('ADR-002');
  expect(commits[0].files).toContain('docs/adr/ADR-002.md');
});
it('미커밋 NOTES.md 감지', async () => {
  const dirty = await scanDirtyFiles(FIXTURE);
  expect(dirty.find(d => d.path === 'NOTES.md')?.status).toBe('??');
});
