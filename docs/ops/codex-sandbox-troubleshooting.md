# Codex CLI sandbox — troubleshooting (dev container)

> Dev-environment note, not part of the docwatch product. Records how the OpenAI
> Codex Claude Code plugin behaves in this Docker/linuxkit container and how to
> recover it when delegated code tasks start failing. Captured 2026-07-09 while
> building `/monitor`.

## TL;DR recovery

If Codex tasks start failing (errors like *"Codex CLI is not installed"*,
*"Failed to write file"*, or `connect ENOENT /tmp/cxc-XXXX/broker.sock`):

```bash
# 1. Confirm what's actually wrong
node "$HOME/.claude/plugins/cache/openai-codex/codex/1.0.5/scripts/codex-companion.mjs" setup --json

# 2. If auth shows "connect ENOENT .../broker.sock", the shared broker pin is stale.
#    Find and remove the stale broker pin (state, NOT plugin code):
grep -rl 'broker.sock' "$HOME/.claude/plugins/data/codex-openai-codex/state/"*/broker.json
mv <that-broker.json> <that-broker.json>.bak
rm -rf /tmp/cxc-XXXX            # the dead sessionDir referenced in that file

# 3. Re-check — should now report ready:true / loggedIn:true
node "$HOME/.claude/plugins/cache/openai-codex/codex/1.0.5/scripts/codex-companion.mjs" setup --json
```

The next Codex `task`/`review` spawns a fresh broker on demand.

## Environment facts

- Docker Desktop (Mac Silicon → linuxkit aarch64), Ubuntu-based container.
- **No sudo**, no `apt`. Cannot install packages as the `ysj` user.
- **bubblewrap IS installed and works** (`/usr/bin/bwrap` 0.6.1; `bwrap --ro-bind / / --dev /dev echo ok` succeeds). This is the original container-level fix (Dockerfile `bubblewrap` + docker-compose `cap_add: SYS_ADMIN` + `seccomp:unconfined`) and it is intact.
- Codex CLI is installed and authenticated (`codex-cli 0.142.5`, ChatGPT login active).

## What actually breaks (two independent problems)

### 1. `apply_patch` (editing existing files) is structurally broken here
- **CREATE (new file) works.** Codex reliably creates brand-new files via its background `task` path (verified: generated `monitor.astro`, test specs, `src/data/diff.ts`).
- **EDIT (apply_patch on an existing file) fails**, even with a healthy runtime, with:
  ```
  Failed to create unified exec process: No such file or directory (os error 2)
  ```
  This is independent of the broker state — it did not recover after the broker fix below. The apply_patch exec layer simply does not work in this container.
- **Operating rule:** route **new-file generation to Codex**; do **edits of existing files with Claude's own editor**. Don't waste a round-trip sending edits to Codex here.

### 2. The shared broker can wedge / be orphaned
- The plugin runs **one shared app-server broker per Claude session**
  (`app-server-broker.mjs serve --endpoint unix:/tmp/cxc-XXXX/broker.sock`), pinned in
  `~/.claude/plugins/data/codex-openai-codex/state/<project-hash>/broker.json`
  (`endpoint`, `pidFile`, `pid`, `sessionDir`).
- If that broker dies or wedges, `setup --json` reports `ready:false`,
  `auth.detail: "connect ENOENT /tmp/cxc-XXXX/broker.sock"`, `loggedIn:false` — even
  though the CLI + auth are fine. Task calls then fail with misleading errors.
- **Do NOT `kill` the broker as a "restart".** Killing it leaves the stale
  `broker.json` pointing at a dead pid → permanent ENOENT loop. (This is exactly how a
  merely-degraded Codex was turned fully unusable during this session.)
- **Never `pkill`.** `pkill -f 'bin/cli.mjs'` (or similar) self-matches the shell
  running the command and kills the session (observed: exit 144). Kill only by exact PID
  from a PID file.
- **Correct recovery:** remove the stale `broker.json` pin (+ the dead `/tmp/cxc-*`
  dir). A fresh broker spawns on the next task. See TL;DR above.

## Timeline of this session's failures (for reference)
1. Early tasks (create files) succeeded via the background `task` path.
2. An edit task failed: `apply_patch verification failed … os error 2` — problem #1.
3. Attempted "fix" by killing the app-server → orphaned the session (problem #2), which
   then surfaced as *"Codex CLI is not installed"* and `connect ENOENT`.
4. `codex-companion.mjs setup --json` pinpointed the dead broker socket.
5. Removed the stale `state/<hash>/broker.json` → `ready:true` immediately.
6. Re-verified: **CREATE works** (new module created in ~5s), **EDIT still fails**
   (`os error 2`) — confirming the two problems are independent.

## companion subcommands
`setup | review | adversarial-review | task | transfer | status | result | cancel`
(No explicit broker-restart command — hence the `broker.json` reset.)

## See also
- Claude auto-memory: `reference-codex-container-sandbox` (same findings, agent-facing).
- User directive: all substantive code implementation is delegated to Codex — this doc
  explains the container-specific exception (edits fall back to Claude).
