#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './cli-args.mjs';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireFromPkg = createRequire(path.join(pkgRoot, 'package.json'));
const astroPkgPath = requireFromPkg.resolve('astro/package.json');
const astroPkg = JSON.parse(fs.readFileSync(astroPkgPath, 'utf8'));
const astroEntry = typeof astroPkg.bin === 'string' ? astroPkg.bin : astroPkg.bin?.astro;

if (!astroEntry) {
  console.error('[docwatch] Could not resolve bundled Astro CLI entry.');
  process.exit(1);
}

let args;
try {
  args = parseArgs(process.argv.slice(2), process.cwd());
} catch (err) {
  console.error(`[docwatch] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const { target, port, open, host } = args;
const astroBin = path.join(path.dirname(astroPkgPath), astroEntry);
const astroArgs = [astroBin, 'dev', '--root', pkgRoot, '--port', String(port)];

if (host !== undefined) {
  astroArgs.push('--host', host);
}

console.log(`[docwatch] watching ${target}`);
const child = spawn(process.execPath, astroArgs, {
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
