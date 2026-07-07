import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig, type DocwatchConfig } from '@/data/config';

describe('mergeConfig', () => {
  it('빈 오버라이드는 기본값 그대로', () => {
    expect(mergeConfig({})).toEqual(DEFAULT_CONFIG);
  });
  it('include 교체', () => {
    expect(mergeConfig({ include: ['x/**/*.md'] }).include).toEqual(['x/**/*.md']);
  });
  it('동명 카테고리는 오버라이드가 승리', () => {
    const merged = mergeConfig({ categories: [{ name: 'ADR', match: 'my/**', icon: '🅰' }] });
    expect(merged.categories.find(c => c.name === 'ADR')).toEqual({ name: 'ADR', match: 'my/**', icon: '🅰' });
  });
  it('오버라이드 안 된 기본 카테고리 보존', () => {
    const merged = mergeConfig({ categories: [{ name: 'ADR', match: 'x' }] });
    expect(merged.categories.some(c => c.name === 'PRD')).toBe(true);
    expect(merged.categories.some(c => c.name === 'Plans')).toBe(true);
  });
});
