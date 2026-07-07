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
