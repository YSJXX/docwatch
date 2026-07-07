import { describe, it, expect } from 'vitest';
import { scanCheckboxes } from '@/data/scan';

describe('scanCheckboxes', () => {
  it('빈 문자열', () => expect(scanCheckboxes('')).toEqual({ total: 0, checked: 0 }));
  it('평면 혼합', () => expect(scanCheckboxes('- [x] a\n- [ ] b\n- [X] c')).toEqual({ total: 3, checked: 2 }));
  it('중첩', () => expect(scanCheckboxes('- [x] a\n  - [ ] a1\n  - [x] a2')).toEqual({ total: 3, checked: 2 }));
  it('코드펜스 무시', () => {
    const md = ['- [x] real', '```', '- [ ] fake', '```', '- [ ] real2'].join('\n');
    expect(scanCheckboxes(md)).toEqual({ total: 2, checked: 1 });
  });
  it('인라인 코드 무시', () => expect(scanCheckboxes('use `- [ ]`\n- [x] done')).toEqual({ total: 1, checked: 1 }));
  it('CRLF', () => expect(scanCheckboxes('- [x] a\r\n- [ ] b')).toEqual({ total: 2, checked: 1 }));
  it('이중 이스케이프 회귀 방지: 리터럴 백슬래시 라인은 미매치', () =>
    expect(scanCheckboxes('- \\[x\\] not-a-box')).toEqual({ total: 0, checked: 0 }));
});
