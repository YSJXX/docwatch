import type { CategoryRule } from './config';

function globToRegex(glob: string): RegExp {
  let re = '^'; let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i += 2; if (glob[i] === '/') i++; }
    else if (c === '*') { re += '[^/]*'; i++; }
    else if (c === '?') { re += '[^/]'; i++; }
    else if ('.^$+(){}|\\'.includes(c)) { re += '\\' + c; i++; }
    else { re += c; i++; }
  }
  return new RegExp(re + '$');
}

export function resolveCategory(sourceRelPath: string, rules: CategoryRule[]): string {
  for (const rule of rules) {
    const pats = Array.isArray(rule.match) ? rule.match : [rule.match];
    if (pats.some(p => globToRegex(p).test(sourceRelPath))) return rule.name;
  }
  const first = sourceRelPath.split('/')[0];
  return first === sourceRelPath ? 'Root' : first;
}
