import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { targetRepoRoot, absFromEntry, idToSourceRel } from '@/data/paths';

describe('targetRepoRoot', () => {
  const saved = process.env.DOCWATCH_ROOT;
  afterEach(() => { process.env.DOCWATCH_ROOT = saved; });
  it('DOCWATCH_ROOT 절대경로 반환', () => {
    process.env.DOCWATCH_ROOT = '/tmp/x';
    expect(targetRepoRoot()).toBe('/tmp/x');
  });
});

describe('absFromEntry', () => {
  it('상대 filePath를 astro 루트 기준 절대화', () => {
    expect(absFromEntry('../target/docs/a.md', '/pkg/viewer')).toBe('/pkg/target/docs/a.md');
  });
  it('절대 filePath는 그대로', () => {
    expect(absFromEntry('/abs/docs/a.md', '/pkg/viewer')).toBe('/abs/docs/a.md');
  });
});

describe('idToSourceRel', () => {
  const roots = ['docs', '.claude', '.omc'];
  it('leading dot 복원: claude → .claude', () => {
    expect(idToSourceRel('claude/plans/plan-a', roots)).toBe('.claude/plans/plan-a.md');
  });
  it('dot 없는 루트는 그대로', () => {
    expect(idToSourceRel('docs/adr/adr-001', roots)).toBe('docs/adr/adr-001.md');
  });
  it('루트 단일 파일: readme → README.md는 매핑 불가 → null (filePath 사용 강제)', () => {
    expect(idToSourceRel('readme', roots)).toBeNull();
  });
});
