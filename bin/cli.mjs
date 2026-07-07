#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './cli-args.mjs';

const { target, port, open } = parseArgs(process.argv.slice(2), process.cwd());
const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log(`[docwatch] watching ${target}`);
const child = spawn('npx', ['astro', 'dev', '--root', pkgRoot, '--port', String(port)], {
  env: { ...process.env, DOCWATCH_ROOT: target, ASTRO_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

let opened = false;
child.stdout.on('data', (buf) => {
  const s = buf.toString();
  process.stdout.write(s);
  const m = s.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
  if (m && open && !opened) {
    opened = true;
    const url = `http://localhost:${m[1]}/`;
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(cmd, [url], { stdio: 'ignore', shell: process.platform === 'win32' }).on('error', () => {});
  }
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
