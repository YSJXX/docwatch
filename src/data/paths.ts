import path from 'node:path';

export function targetRepoRoot(): string {
  const r = process.env.DOCWATCH_ROOT;
  if (r) return path.resolve(r);
  console.warn('[docwatch] DOCWATCH_ROOT unset — falling back to cwd (dev only)');
  return process.cwd();
}

export function absFromEntry(filePath: string, astroRoot: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(astroRoot, filePath);
}

/** 정규화 id → 원본 상대경로 추정. 대소문자 변형·루트 파일은 null (호출측은 filePath 우선). */
export function idToSourceRel(id: string, includeRoots: string[]): string | null {
  const seg = id.split('/');
  if (seg.length === 1) return null; // 루트 파일(readme 등)은 원본 대소문자 복원 불가
  const dotted = '.' + seg[0];
  const root = includeRoots.includes(dotted) ? dotted : includeRoots.includes(seg[0]) ? seg[0] : null;
  if (!root) return null;
  return [root, ...seg.slice(1)].join('/') + '.md';
}
