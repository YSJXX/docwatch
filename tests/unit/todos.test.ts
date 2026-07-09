import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanTodos } from '@/data/todos';
import { DEFAULT_CONFIG } from '@/data/config';

describe('code TODO scanner', () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dw-todos-'));
    await fs.writeFile(
      path.join(root, 'app.ts'),
      [
        '// TODO: alpha',
        'export const x = 1;',
        '  // FIXME beta',
        'const s = "TODO not a marker";',
        '// prose about TODO here',
        '',
      ].join('\n'),
    );
    // markdown is not in todoGlobs — must be ignored
    await fs.writeFile(path.join(root, 'notes.md'), '# TODO in markdown\n');
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('extracts comment markers with tag/line/text, skips literals, prose, and non-source', async () => {
    const items = await scanTodos(root, DEFAULT_CONFIG);
    const flat = items.map(i => `${i.tag}:${i.line}:${i.text}`);

    expect(flat).toContain('TODO:1:alpha');
    expect(flat).toContain('FIXME:3:beta');
    // string literal on a comment-less line
    expect(items.some(i => i.text.includes('not a marker'))).toBe(false);
    // prose where the tag is not right after the comment starter (line 5)
    expect(items.some(i => i.line === 5)).toBe(false);
    // markdown is not a scanned source type
    expect(items.some(i => i.file.endsWith('.md'))).toBe(false);
  });
});
