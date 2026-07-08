import { describe, expect, it } from 'vitest';
import { buildDocIndex, fileToDocId } from '@/data/paths';

describe('doc source path index', () => {
  const root = '/tmp/docwatch-target';
  const entries = [
    {
      id: 'docs/adr/adr-001',
      filePath: `${root}/docs/adr/ADR-001.md`,
    },
    {
      id: 'docs/superpowers/plans/2026-07-08-cockpit',
      filePath: `${root}/docs/superpowers/plans/2026-07-08-cockpit.md`,
    },
  ];

  it('maps an indexed doc source path to its entry id', () => {
    process.env.DOCWATCH_ROOT = root;
    const idx = buildDocIndex(entries);

    expect(fileToDocId('docs/adr/ADR-001.md', idx)).toBe('docs/adr/adr-001');
  });

  it('does not map directories or non-doc files', () => {
    process.env.DOCWATCH_ROOT = root;
    const idx = buildDocIndex(entries);

    expect(fileToDocId('docs/superpowers/plans/', idx)).toBeNull();
    expect(fileToDocId('apps/mobile/app.json', idx)).toBeNull();
  });
});
