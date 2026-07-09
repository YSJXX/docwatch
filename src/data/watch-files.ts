import path from 'node:path';
import fg from 'fast-glob';
import type { DocwatchConfig } from './config';

export type WatchedFile = { rel: string; abs: string };

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Scan the target repo for non-markdown "watched" config/manifest files. */
export async function scanWatchedFiles(rootDir: string, cfg: DocwatchConfig): Promise<WatchedFile[]> {
  try {
    const abs = await fg(cfg.watchFiles, { cwd: rootDir, absolute: true, ignore: cfg.exclude, dot: true });
    return abs
      .map(a => ({ rel: path.relative(rootDir, a).split(path.sep).join('/'), abs: a }))
      .sort((a, b) => a.rel.localeCompare(b.rel));
  } catch {
    return [];
  }
}

/** True iff `rel` (posix-normalized) is one of the watched files. */
export function isWatchedRel(rel: string, files: WatchedFile[]): boolean {
  const norm = normalizeRel(rel);
  return files.some(f => f.rel === norm);
}
