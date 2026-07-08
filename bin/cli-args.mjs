import path from 'node:path';

export function parseArgs(argv, cwd) {
  let target = cwd;
  let port = 4321;
  let open = true;
  let host;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') {
      const value = argv[++i];
      port = parsePort(value);
    }
    else if (a === '--host') {
      host = argv[++i];
      if (host === undefined) {
        throw new Error('Missing value for --host');
      }
    }
    else if (a === '--no-open') open = false;
    else if (!a.startsWith('-')) target = path.resolve(cwd, a);
  }

  return { target, port, open, host };
}

function parsePort(value) {
  if (value === undefined) {
    throw new Error('Missing value for --port');
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port >= 65536) {
    throw new Error(`Invalid --port "${value}": expected an integer from 1 to 65535`);
  }

  return port;
}
