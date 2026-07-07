import { describe, it, expect } from 'vitest';
import { resolveCategory } from '@/data/categories';
import type { CategoryRule } from '@/data/config';

const RULES: CategoryRule[] = [
  { name: 'ADR',   match: 'docs/adr/**' },
  { name: 'PRD',   match: ['docs/prd*', '.omc/prd-*'] },
  { name: 'Plans', match: '.claude/plans/**' },
  { name: 'Root',  match: ['AGENTS.md', 'README.md', 'CLAUDE.md'] },
];

describe('resolveCategory', () => {
  it('순서 우선 첫 매치', () => expect(resolveCategory('docs/adr/x.md', RULES)).toBe('ADR'));
  it('배열 glob', () => expect(resolveCategory('.omc/prd-yt.md', RULES)).toBe('PRD'));
  it('딥 glob', () => expect(resolveCategory('.claude/plans/p.md', RULES)).toBe('Plans'));
  it('루트 정확 매치', () => expect(resolveCategory('AGENTS.md', RULES)).toBe('Root'));
  it('폴백: 첫 세그먼트', () => expect(resolveCategory('apps/b/AGENTS.md', RULES)).toBe('apps'));
  it('루트 무매치 파일 → Root', () => expect(resolveCategory('notes.md', RULES)).toBe('Root'));
});
