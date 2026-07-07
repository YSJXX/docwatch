import { describe, it, expect } from 'vitest';
import { aggregateByCategory } from '@/data/scan';
import type { CategoryRule } from '@/data/config';

const RULES: CategoryRule[] = [{ name: 'ADR', match: 'docs/adr/**' }, { name: 'Plans', match: '.claude/plans/**' }];

it('그룹·합산·백분율', () => {
  const agg = aggregateByCategory([
    { sourceRelPath: 'docs/adr/a.md', content: '- [x] a\n- [ ] b' },
    { sourceRelPath: 'docs/adr/b.md', content: '- [x] c' },
    { sourceRelPath: '.claude/plans/p.md', content: '- [ ] x\n- [ ] y' },
  ], RULES);
  const adr = agg.find(a => a.category === 'ADR')!;
  expect(adr).toMatchObject({ docCount: 2, total: 3, checked: 2 });
  expect(adr.percent).toBeCloseTo(200 / 3, 1);
  expect(agg.find(a => a.category === 'Plans')!.percent).toBe(0);
});
it('체크박스 0개 → percent 0', () => {
  expect(aggregateByCategory([{ sourceRelPath: 'docs/adr/x.md', content: '# none' }], RULES)[0].percent).toBe(0);
});
