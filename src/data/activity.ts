import path from 'node:path';
import fs from 'node:fs/promises';
import fg from 'fast-glob';
import { scanDirtyFiles, type DirtyEntry } from './scan';
import type { DocwatchConfig } from './config';

export type Activity = {
  dirty: DirtyEntry[];
  recentlyModified: Array<{ path: string; mtime: number }>;
  activePlan: { path: string; title: string } | null;
  generatedAt: number;
};

const FIVE_MIN = 300_000, THIRTY_MIN = 1_800_000;

async function firstHeading(abs: string): Promise<string> {
  try {
    const m = (await fs.readFile(abs, 'utf8')).match(/^#\s+(.+)$/m);
    return m ? m[1].trim() : path.basename(abs, '.md');
  } catch { return path.basename(abs); }
}

export async function getActivity(rootDir: string, cfg: DocwatchConfig): Promise<Activity> {
  const now = Date.now();
  const [dirty, absPaths] = await Promise.all([
    scanDirtyFiles(rootDir).catch(() => [] as DirtyEntry[]),
    fg(cfg.include, { cwd: rootDir, absolute: true, ignore: cfg.exclude, dot: true }),
  ]);
  const stats = (await Promise.all(absPaths.map(async a => {
    const s = await fs.stat(a).catch(() => null);
    return s ? { rel: path.relative(rootDir, a).split(path.sep).join('/'), mtime: s.mtimeMs, abs: a } : null;
  }))).filter((x): x is NonNullable<typeof x> => !!x);

  const recentlyModified = stats.filter(m => now - m.mtime <= FIVE_MIN)
    .sort((a, b) => b.mtime - a.mtime).slice(0, 10)
    .map(({ rel, mtime }) => ({ path: rel, mtime }));

  const fresh = (xs: typeof stats) => xs.filter(m => now - m.mtime <= THIRTY_MIN).sort((a, b) => b.mtime - a.mtime);
  const chosen = fresh(stats.filter(m => m.rel.startsWith('.claude/plans/')))[0] ?? fresh(stats)[0] ?? null;

  return {
    dirty, recentlyModified, generatedAt: now,
    activePlan: chosen ? { path: chosen.rel, title: await firstHeading(chosen.abs) } : null,
  };
}
