import path from 'node:path';
import { DEFAULT_CONFIG } from './config';

type DocIndexEntry = {
  id: string;
  filePath?: string;
};

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

function normalizeRelPath(fileRelPath: string): string | null {
  const hadTrailingSlash = /[\\/]$/.test(fileRelPath);
  const normalized = path.posix.normalize(fileRelPath.replace(/\\/g, '/')).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || hadTrailingSlash) return null;
  return normalized;
}

export function buildDocIndex(entries: DocIndexEntry[]): Map<string, string> {
  const root = targetRepoRoot();
  const includeRoots = [...new Set(DEFAULT_CONFIG.include.map(pattern => pattern.split('/')[0]))];
  const index = new Map<string, string>();

  for (const entry of entries) {
    const sourceRelPath = entry.filePath
      ? path.relative(root, absFromEntry(entry.filePath, process.cwd())).split(path.sep).join('/')
      : idToSourceRel(entry.id, includeRoots) ?? `${entry.id}.md`;
    const normalized = normalizeRelPath(sourceRelPath);
    if (normalized) index.set(normalized, entry.id);
  }

  return index;
}

export function fileToDocId(fileRelPath: string, index: Map<string, string>): string | null {
  const normalized = normalizeRelPath(fileRelPath);
  if (!normalized) return null;

  const exact = index.get(normalized);
  if (exact) return exact;

  const dir = path.posix.dirname(normalized);
  const base = path.posix.basename(normalized).toLowerCase();
  for (const [sourceRelPath, id] of index) {
    if (path.posix.dirname(sourceRelPath) !== dir) continue;
    if (path.posix.basename(sourceRelPath).toLowerCase() === base) return id;
  }

  return null;
}
