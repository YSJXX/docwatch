import path from 'node:path';

export function parseArgs(argv, cwd) {
  let target = cwd;
  let port = 4321;
  let open = true;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') port = Number(argv[++i]);
    else if (a === '--no-open') open = false;
    else if (!a.startsWith('-')) target = path.resolve(cwd, a);
  }

  return { target, port, open };
}
