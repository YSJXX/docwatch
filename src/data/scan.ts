import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const CHECKBOX_LINE = /^\s*[-*+]\s+\[([ xX])\]\s+/;

export function scanCheckboxes(markdown: string): { total: number; checked: number } {
  let total = 0, checked = 0, inFence = false;
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*```/.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const line = raw.replace(/`[^`\n]*`/g, '');
    const m = CHECKBOX_LINE.exec(line);
    if (m) { total++; if (m[1] !== ' ') checked++; }
  }
  return { total, checked };
}

export type Commit = { sha: string; author: string; relTime: string; subject: string; files: string[] };

export async function scanGitLog(rootDir: string, limit = 50): Promise<Commit[]> {
  const SEP = '|~dw~|';
  const { stdout } = await execFile('git',
    ['-C', rootDir, 'log', `--pretty=format:%x00%H${SEP}%an${SEP}%ar${SEP}%s`, '--name-only', `-n${limit}`],
    { maxBuffer: 32 * 1024 * 1024 });
  return stdout.split('\0').filter(Boolean).map(chunk => {
    const [meta, ...fileLines] = chunk.trim().split('\n');
    const [sha, author, relTime, subject] = meta.split(SEP);
    return { sha, author, relTime, subject, files: fileLines.map(f => f.trim()).filter(Boolean) };
  });
}

export type DirtyEntry = { path: string; status: 'M'|'A'|'D'|'??'|'R' };

export async function scanDirtyFiles(rootDir: string): Promise<DirtyEntry[]> {
  const { stdout } = await execFile('git', ['-C', rootDir, 'status', '--porcelain', '-z'], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.split('\0').filter(Boolean).map(p => {
    const code = p.slice(0, 2).trim();
    return { path: p.slice(3), status: (code[0] === '?' ? '??' : code[0]) as DirtyEntry['status'] };
  });
}
