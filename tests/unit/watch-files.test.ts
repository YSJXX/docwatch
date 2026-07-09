import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanWatchedFiles, isWatchedRel } from '@/data/watch-files';
import { DEFAULT_CONFIG } from '@/data/config';

describe('watched files scanner', () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-watch-'));
    await fs.writeFile(path.join(root, 'package.json'), '{}');
    await fs.writeFile(path.join(root, 'tsconfig.json'), '{}');
    await fs.writeFile(path.join(root, 'notes.md'), '# not a config');
    await fs.mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
    await fs.writeFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: ci');
    await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules', 'package.json'), '{}');
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('picks up config/manifest files and ignores non-config + excluded dirs', async () => {
    const rels = (await scanWatchedFiles(root, DEFAULT_CONFIG)).map(f => f.rel);
    expect(rels).toContain('package.json');
    expect(rels).toContain('tsconfig.json');
    expect(rels).toContain('.github/workflows/ci.yml');
    expect(rels).not.toContain('notes.md');
    expect(rels).not.toContain('node_modules/package.json');
  });

  it('isWatchedRel matches only scanned files (posix-normalized)', async () => {
    const files = await scanWatchedFiles(root, DEFAULT_CONFIG);
    expect(isWatchedRel('package.json', files)).toBe(true);
    expect(isWatchedRel('./package.json', files)).toBe(true);
    expect(isWatchedRel('notes.md', files)).toBe(false);
    expect(isWatchedRel('src/data/scan.ts', files)).toBe(false);
  });
});
