import path from 'node:path';
import fs from 'node:fs/promises';
import fg from 'fast-glob';
import type { DocwatchConfig } from './config';

export type TodoTag = 'TODO' | 'FIXME' | 'HACK' | 'XXX';
export type TodoItem = { file: string; line: number; tag: TodoTag; text: string };

// Tag must sit right after a comment starter (+ optional whitespace) so regex literals
// and prose that merely mentions "TODO" do not false-positive.
const MARKER = /(?:\/\/|#|\/\*|\*|<!--|--)\s*(TODO|FIXME|HACK|XXX)\b[:\-\s]*(.*)$/;
const MAX_SIZE = 512 * 1024;

/** Scan source files for TODO/FIXME/HACK/XXX comment markers (read-only monitoring). */
export async function scanTodos(rootDir: string, cfg: DocwatchConfig, maxItems = 200): Promise<TodoItem[]> {
  try {
    const paths = (await fg(cfg.todoGlobs, { cwd: rootDir, ignore: cfg.exclude, dot: true, absolute: true }))
      .map(abs => ({ abs, rel: path.relative(rootDir, abs).split(path.sep).join('/') }))
      .sort((a, b) => a.rel.localeCompare(b.rel));

    const out: TodoItem[] = [];
    for (const { abs, rel } of paths) {
      if (out.length >= maxItems) break;
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat || stat.size > MAX_SIZE) continue;
      const content = await fs.readFile(abs, 'utf8').catch(() => null);
      if (content === null) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (out.length >= maxItems) break;
        const m = MARKER.exec(lines[i]);
        if (!m) continue;
        const tag = m[1].toUpperCase() as TodoTag;
        const text = m[2].trim().replace(/\s*(?:\*\/|-->)\s*$/, '').trim();
        out.push({ file: rel, line: i + 1, tag, text });
      }
    }
    return out;
  } catch {
    return [];
  }
}
