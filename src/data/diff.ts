import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export type DiffLine = { t: 'add' | 'del' | 'ctx'; s: string };

const SKIP_PREFIXES = [
  'diff ',
  'index ',
  '--- ',
  '+++ ',
  '@@',
  'new file',
  'deleted file',
  'old mode',
  'new mode',
  'similarity ',
  'rename ',
  'copy ',
  'Binary files ',
];

export async function scanDiff(rootDir: string, relPath: string, maxLines = 200): Promise<DiffLine[]> {
  try {
    const { stdout } = await execFile('git',
      ['-C', rootDir, 'diff', '--no-color', '--', relPath],
      { maxBuffer: 8 * 1024 * 1024 });
    const lines: DiffLine[] = [];

    for (const raw of stdout.split('\n')) {
      if (lines.length >= maxLines) break;
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (SKIP_PREFIXES.some(prefix => line.startsWith(prefix))) continue;

      if (line.startsWith('+')) lines.push({ t: 'add', s: line.slice(1) });
      else if (line.startsWith('-')) lines.push({ t: 'del', s: line.slice(1) });
      else lines.push({ t: 'ctx', s: line.startsWith(' ') ? line.slice(1) : line });
    }

    while (lines.at(-1)?.t === 'ctx' && lines.at(-1)?.s === '') lines.pop();

    return lines;
  } catch {
    return [];
  }
}
