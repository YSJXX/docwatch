import { describe, expect, it } from 'vitest';
import { buildDocIndex, fileToDocId } from '@/data/paths';

describe('doc source path index dotted roots', () => {
  const root = '/tmp/docwatch-target';

  it('maps a dotted root source path when filePath is present', () => {
    process.env.DOCWATCH_ROOT = root;
    const idx = buildDocIndex([
      {
        id: 'omc/plans/foo',
        filePath: `${root}/.omc/plans/foo.md`,
      },
    ]);

    expect(fileToDocId('.omc/plans/foo.md', idx)).toBe('omc/plans/foo');
  });

  it('reconstructs .claude source paths when filePath is absent', () => {
    process.env.DOCWATCH_ROOT = root;
    const idx = buildDocIndex([
      {
        id: 'claude/plans/bar',
      },
    ]);

    expect(fileToDocId('.claude/plans/bar.md', idx)).toBe('claude/plans/bar');
  });

  it('does not map dotted root directories', () => {
    process.env.DOCWATCH_ROOT = root;
    const idx = buildDocIndex([
      {
        id: 'omc/plans/foo',
        filePath: `${root}/.omc/plans/foo.md`,
      },
    ]);

    expect(fileToDocId('.omc/plans/', idx)).toBeNull();
  });
});
