import type { APIRoute } from 'astro';
import chokidar from 'chokidar';
import { getActivity } from '@/data/activity';
import { DEFAULT_CONFIG } from '@/data/config';
import { targetRepoRoot } from '@/data/paths';

export const prerender = false;

// Server-Sent Events: pushes an Activity snapshot on connect, then again
// (debounced) whenever a watched doc or the git state changes. Replaces the
// client-side poll of /api/activity.json.
export const GET: APIRoute = async () => {
  const root = targetRepoRoot();
  const encoder = new TextEncoder();

  let watcher: ReturnType<typeof chokidar.watch> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const enqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (data: unknown) => enqueue(`data: ${JSON.stringify(data)}\n\n`);
      const push = async () => {
        try {
          send(await getActivity(root, DEFAULT_CONFIG));
        } catch {
          /* transient scan error — skip this tick */
        }
      };

      await push(); // initial snapshot

      let inFlight = false;
      let pending = false;
      const schedule = () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(async () => {
          if (inFlight) {
            pending = true;
            return;
          }
          inFlight = true;
          await push();
          inFlight = false;
          if (pending) {
            pending = false;
            schedule();
          }
        }, 250);
      };

      watcher = chokidar.watch([...DEFAULT_CONFIG.include, '.git/HEAD', '.git/index'], {
        cwd: root,
        ignoreInitial: true,
        followSymlinks: false,
        ignored: DEFAULT_CONFIG.exclude,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      });
      watcher.on('all', schedule);

      heartbeat = setInterval(() => enqueue(': ping\n\n'), 25_000);
    },
    async cancel() {
      if (debounce) clearTimeout(debounce);
      if (heartbeat) clearInterval(heartbeat);
      if (watcher) await watcher.close();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
};
