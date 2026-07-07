import chokidar from 'chokidar';
import path from 'node:path';

export function startGitWatch(rootDir: string, onGitChange: () => void) {
  const watcher = chokidar.watch(
    [path.join(rootDir, '.git/HEAD'), path.join(rootDir, '.git/index')],
    { ignoreInitial: true, followSymlinks: false, awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } },
  );
  watcher.on('all', () => onGitChange());
  return { close: () => watcher.close() };
}
